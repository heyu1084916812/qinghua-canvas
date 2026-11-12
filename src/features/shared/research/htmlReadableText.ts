import { decodeHtmlEntities, INLINE_TAG, inlineTextOf } from './htmlText'

/**
 * 原网页 HTML → 可读正文（Jina Reader 失败时的本机兜底，2026-11-12）。
 *
 * 只做稳定的字符串处理：去掉脚本 / 样式 / 导航等噪声，优先取 `<article>`（多个时取文字最多的），
 * 其次 `<main>` / `role="main"`，最后整个 `<body>`；块级标签换行、列表项加 `- `，行内标签直接拼接。
 * 不执行任何页面脚本——靠脚本渲染的页面这里读不到正文，由调用方如实报告。
 */
export interface ReadableHtml {
  title: string
  text: string
}

const NOISE_BLOCKS =
  /<(script|style|noscript|template|svg|iframe|canvas|object|embed|select|button)\b[\s\S]*?<\/\1\s*>/gi
const CHROME_BLOCKS = /<(nav|aside|footer|form)\b[\s\S]*?<\/\1\s*>/gi
const BLOCK_TAGS =
  'p|div|section|article|main|header|ul|ol|li|h[1-6]|tr|table|thead|tbody|blockquote|pre|figure|figcaption|dl|dd|dt|hr'
/** 正文区至少这么多字（或占全页一半以上）才算选对了；否则退回更大的区域。 */
const MIN_REGION_CHARS = 200
/** 标题前留一个空行的占位；段落之间不留空行，保持正文紧凑。 */
const SECTION_BREAK = '\u0000section\u0000'

function metaContent(html: string, property: string): string {
  const escaped = property.replace(/[.:]/g, '\\$&')
  const forward = new RegExp(
    `<meta\\b[^>]*\\b(?:property|name)=["']${escaped}["'][^>]*\\bcontent=["']([^"']*)["']`,
    'i',
  )
  const backward = new RegExp(
    `<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*\\b(?:property|name)=["']${escaped}["']`,
    'i',
  )
  return (forward.exec(html)?.[1] ?? backward.exec(html)?.[1] ?? '').trim()
}

function titleOf(html: string): string {
  const og = metaContent(html, 'og:title')
  if (og) return inlineTextOf(og)
  return inlineTextOf(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? '')
}

/** 从 `openIndex` 处的开始标签起，按同名标签配平，返回元素内部 HTML。 */
function balancedInner(html: string, openIndex: number, tag: string): string {
  const openEnd = html.indexOf('>', openIndex)
  if (openEnd < 0) return ''
  const pattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  pattern.lastIndex = openEnd + 1
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    depth += match[1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(openEnd + 1, match.index)
  }
  return html.slice(openEnd + 1)
}

function elementsOf(html: string, tag: string): string[] {
  const out: string[] = []
  const pattern = new RegExp(`<${tag}\\b[^>]*>`, 'gi')
  let match: RegExpExecArray | null
  let consumedUntil = 0
  while ((match = pattern.exec(html)) !== null) {
    if (match.index < consumedUntil) continue
    const inner = balancedInner(html, match.index, tag)
    out.push(inner)
    consumedUntil = match.index + match[0].length + inner.length
  }
  return out
}

function roleMainOf(html: string): string {
  const match = /<([a-z][\w-]*)\b[^>]*\brole=["']main["'][^>]*>/i.exec(html)
  return match ? balancedInner(html, match.index, match[1]!) : ''
}

function blockText(html: string): string {
  const blockClose = new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, 'gi')
  const blockOpen = new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi')
  const text = decodeHtmlEntities(
    html
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<h([1-6])\b[^>]*>/gi, `\n${SECTION_BREAK}\n`)
      .replace(blockClose, '\n')
      .replace(blockOpen, '\n')
      .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' ')
      .replace(INLINE_TAG, '')
      .replace(/<[^>]*>/g, ' '),
  )
  const lines: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[ \t\f\v\u00a0\u3000]+/g, ' ').trim()
    if (!line || line === '-') continue
    if (line === SECTION_BREAK) {
      if (lines.length > 0 && lines.at(-1) !== '') lines.push('')
      continue
    }
    lines.push(line)
  }
  while (lines.at(-1) === '') lines.pop()
  return lines.join('\n')
}

function visibleLength(html: string): number {
  return inlineTextOf(html).length
}

/** 选正文区域：最长的 `<article>` → `<main>` / role=main → `<body>` → 全文。 */
function contentRegion(html: string): string {
  const body = elementsOf(html, 'body')[0]
  const pageLength = visibleLength(body ?? html)
  const substantial = (length: number) =>
    length >= MIN_REGION_CHARS || (length > 0 && length * 2 >= pageLength)
  const articles = elementsOf(html, 'article')
    .map((inner) => ({ inner, length: visibleLength(inner) }))
    .sort((left, right) => right.length - left.length)
  const bestArticle = articles[0]
  if (bestArticle && substantial(bestArticle.length)) return bestArticle.inner
  const main = elementsOf(html, 'main')[0] ?? roleMainOf(html)
  if (main && substantial(visibleLength(main))) return main
  return body ?? html
}

export function htmlToReadableText(html: string): ReadableHtml {
  const title = titleOf(html)
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ')
    .replace(NOISE_BLOCKS, ' ')
    .replace(CHROME_BLOCKS, ' ')
  return { title, text: blockText(contentRegion(cleaned)) }
}
