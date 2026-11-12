import { clipText, decodeHtmlEntities, inlineTextOf, parseTagAttributes } from './htmlText'

/**
 * Bing 结果页（网页 / 图片）HTML → 结构化命中。纯函数，不发请求。
 *
 * 只依赖 Bing 多年未变的几处骨架（2026-11-12 实抓核对，fixture 见 `fixtures/bing-*.html`）：
 * - 网页：`<li class="b_algo">` 内第一个 `<h2><a href>` 是标题与链接，链接多为
 *   `https://www.bing.com/ck/a?…&u=a1<base64url(原地址)>` 跳转；摘要在 `.b_caption` 的 `<p>`。
 * - 图片：`<a class="iusc" m="{json}">`，JSON 里 `purl` 来源页、`murl` 原图、`turl` 缩略图、
 *   `t` 标题、`desc` 描述。
 *
 * 结构对不上时不猜：返回空命中并给出页面状态（验证码 / 无结果 / 无法识别），由调用方决定回退。
 */

export type BingPageStatus = 'ok' | 'empty' | 'captcha' | 'unrecognized'

export interface BingWebHit {
  title: string
  url: string
  snippet: string
}

export interface BingImageHit {
  title: string
  /** 图片所在网页。 */
  pageUrl: string
  /** 原图地址。 */
  imageUrl: string
  /** Bing 缩略图（tse*.mm.bing.net / th.bing.com），原图防盗链时作备用。 */
  thumbnailUrl: string
  description: string
}

export interface BingParseResult<T> {
  status: BingPageStatus
  hits: T[]
}

const CAPTCHA_PATTERNS: readonly RegExp[] = [
  /\bcaptcha\b/i,
  /\/turing\//i,
  /unusual traffic/i,
  /verify (that )?you are (a )?human/i,
  /are you a robot/i,
  /异常流量/,
  /人机验证/,
  /验证你是人类|验证您是人类/,
  /请(完成|进行)验证/,
]

/** 有搜索框说明确实是 Bing 结果页（只是没结果），否则视为被拦截或改版。 */
const SEARCH_PAGE_MARKER = /\bid=["']?sb_form_q\b/i

function visibleText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
}

function statusWithoutHits(html: string): BingPageStatus {
  const text = `${/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''}\n${visibleText(html)}`
  if (CAPTCHA_PATTERNS.some((pattern) => pattern.test(text))) return 'captcha'
  if (/id=["']?b_captcha|\/turing\/captcha/i.test(html)) return 'captcha'
  return SEARCH_PAGE_MARKER.test(html) ? 'empty' : 'unrecognized'
}

function base64UrlToText(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * 解开 Bing 的点击跳转。`u` 参数是 `a1` + base64url(原地址)；不是跳转链接就原样返回。
 * 解不开时返回空串，调用方丢弃这条命中（不能把 bing.com 的跳转页当成来源）。
 */
export function decodeBingRedirect(raw: string): string {
  const href = decodeHtmlEntities(raw.trim())
  let url: URL
  try {
    url = new URL(href, 'https://www.bing.com')
  } catch {
    return ''
  }
  const host = url.hostname.toLowerCase()
  const isBing = host === 'bing.com' || host.endsWith('.bing.com')
  if (!isBing) return isHttpUrl(url.href) ? url.href : ''
  if (!url.pathname.startsWith('/ck/')) return ''
  const encoded = url.searchParams.get('u') ?? ''
  if (!/^a1[\w-]+$/.test(encoded)) return ''
  try {
    const target = base64UrlToText(encoded.slice(2))
    return isHttpUrl(target) ? target : ''
  } catch {
    return ''
  }
}

const WEB_BLOCK_START = /<li\b[^>]*\bclass\s*=\s*["'][^"']*\bb_algo\b[^"']*["'][^>]*>/gi
const WEB_BLOCK_END = /<li\b[^>]*\bclass\s*=\s*["'][^"']*\bb_(?:pag|ans)\b|<\/ol\s*>/i

function webBlocks(html: string): string[] {
  const starts = [...html.matchAll(WEB_BLOCK_START)].map((match) => match.index ?? 0)
  return starts.map((start, index) => {
    const next = starts[index + 1] ?? html.length
    const slice = html.slice(start, next)
    const end = WEB_BLOCK_END.exec(slice.slice(1))
    return end ? slice.slice(0, end.index + 1) : slice
  })
}

function snippetOf(block: string): string {
  const caption = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bb_caption\b[^"']*["'][^>]*>([\s\S]*)/i
    .exec(block)?.[1] ?? block
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/i.exec(caption)?.[1] ?? ''
  return clipText(
    inlineTextOf(paragraph.replace(/<span\b[^>]*\bnews_dt\b[^>]*>[\s\S]*?<\/span>/gi, ''))
      .replace(/^[·\s]+/, ''),
    400,
  )
}

/** 解析 `www.bing.com/search` 结果页。 */
export function parseBingWebResults(html: string): BingParseResult<BingWebHit> {
  const hits: BingWebHit[] = []
  const seen = new Set<string>()
  for (const block of webBlocks(html)) {
    const anchor = /<h2\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i.exec(block)
    if (!anchor) continue
    const url = decodeBingRedirect(parseTagAttributes(anchor[1] ?? '').href ?? '')
    if (!url || seen.has(url)) continue
    const title = clipText(inlineTextOf(anchor[2] ?? ''), 160)
    if (!title) continue
    seen.add(url)
    hits.push({ title, url, snippet: snippetOf(block) })
  }
  return { status: hits.length > 0 ? 'ok' : statusWithoutHits(html), hits }
}

interface BingImageMeta {
  purl?: unknown
  murl?: unknown
  turl?: unknown
  t?: unknown
  desc?: unknown
}

/** Bing 用私有区字符 U+E000 / U+E001 包住命中词（高亮），展示前去掉。 */
function stringField(value: unknown): string {
  return typeof value === 'string'
    ? decodeHtmlEntities(value).replace(/[\ue000-\ue00f]/g, '').trim()
    : ''
}

/** 解析 `www.bing.com/images/search`（或 `/images/async`）结果页。 */
export function parseBingImageResults(html: string): BingParseResult<BingImageHit> {
  const hits: BingImageHit[] = []
  const seen = new Set<string>()
  for (const match of html.matchAll(/<a\b([^>]*\bclass\s*=\s*["'][^"']*\biusc\b[^>]*)>/gi)) {
    const raw = parseTagAttributes(match[1] ?? '').m ?? ''
    let meta: BingImageMeta
    try {
      meta = JSON.parse(raw) as BingImageMeta
    } catch {
      continue
    }
    if (!meta || typeof meta !== 'object') continue
    const imageUrl = stringField(meta.murl)
    const thumbnailUrl = stringField(meta.turl)
    const pageUrl = stringField(meta.purl)
    const usableImage = isHttpUrl(imageUrl) ? imageUrl : ''
    const usableThumb = isHttpUrl(thumbnailUrl) ? thumbnailUrl : ''
    if (!usableImage && !usableThumb) continue
    const key = usableImage || usableThumb
    if (seen.has(key)) continue
    seen.add(key)
    const title = clipText(inlineTextOf(stringField(meta.t)), 160)
    hits.push({
      title,
      pageUrl: isHttpUrl(pageUrl) ? pageUrl : '',
      imageUrl: usableImage,
      thumbnailUrl: usableThumb,
      description: clipText(inlineTextOf(stringField(meta.desc)) || title, 400),
    })
  }
  return { status: hits.length > 0 ? 'ok' : statusWithoutHits(html), hits }
}
