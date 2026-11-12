/**
 * 抓来的 HTML 片段 → 纯文本的最小工具集（免 Key 搜索结果解析与网页正文兜底共用）。
 *
 * 只做字符串层面的处理，不依赖 DOMParser：同一份代码要在 Vitest（node）、浏览器与
 * Tauri webview 里给出一致结果，而且输入是不可信的外部页面，不能交给真实 DOM 去解析执行。
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '',
  zwj: '',
}

function codePointText(codePoint: number, fallback: string): string {
  return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : fallback
}

/** 解码命名实体与数字实体；不认识的实体原样保留，避免把正文里的 `&` 吃掉。 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);?/gi, (match, token: string) => {
    const normalized = token.toLowerCase()
    if (normalized.startsWith('#x')) {
      return codePointText(Number.parseInt(normalized.slice(2), 16), match)
    }
    if (normalized.startsWith('#')) {
      return codePointText(Number.parseInt(normalized.slice(1), 10), match)
    }
    return NAMED_ENTITIES[normalized] ?? match
  })
}

/**
 * 行内标签（`<strong>` 高亮等）直接删掉而不是换成空格：中文没有词间空格，
 * `咖啡<strong>网</strong>` 必须还原成“咖啡网”。
 */
export const INLINE_TAG =
  /<\/?(?:a|abbr|b|bdi|bdo|cite|code|em|font|i|mark|q|s|small|span|strong|sub|sup|u|wbr)\b[^>]*>/gi

/** 去掉所有标签、解码实体并压缩空白；用于标题、摘要这类单行文本。 */
export function inlineTextOf(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(INLINE_TAG, '')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析一个开始标签内部的属性串（`a href="…" m='{…}'`），属性名统一小写、值已解码。 */
export function parseTagAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1]?.toLowerCase()
    if (!name || name in attrs) continue
    attrs[name] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

/** 把文本截到 `limit` 个字符，超出时以省略号收尾。 */
export function clipText(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, Math.max(1, limit - 1))}…`
}
