import type { DesignResearchItem, ResearchProvider } from '../../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import { fetchSiteText, plainTitle, siteFailureText, siteFetchFailureOf } from './siteFetch'
import { mentionsKeyTerm, queryKeyTerms, siteSearchQuery } from './siteRelevance'
import type { DirectSiteAdapter, SiteAdapterId, SiteAdapterOutcome } from './types'

/**
 * WordPress 设计博客的直连适配器（2026-11-14）：站点自带的 REST 接口
 * `GET /wp-json/wp/v2/posts?search=<词>&orderby=relevance&_embed=wp:featuredmedia` 返回文章 + 题图，
 * 免登录、免 Key，比解析主题 HTML 稳（换主题不影响）。
 *
 * 实测（2026-11-14，沙箱 curl，浏览器 UA）：
 * - **The Dieline**：REST 200、相关性正常（「tea packaging」前 10 条都是茶包装）；无头浏览器打开搜索页却会被
 *   hashcash 验证挡住 ⇒ 由浏览器站改为直连。
 * - **BP&O（bpando.org）**：REST 200，Cloudflare 放行。
 * - 一定要带 `orderby=relevance`：不带时两站的边缘缓存偶尔把 `search` 忽略、回最新文章。
 * - 中文词两站都 0 条 ⇒ 标 `queryLanguage: 'en'`，先用模型给的英文角度。
 * - 站内搜索是全文 OR 式匹配，结果过 `siteRelevance` 的题目相关性闸门（BP&O 搜「tea packaging design」原本前 5 条一条茶都没有）。
 */
export interface WordPressSiteSpec {
  id: Extract<SiteAdapterId, 'thedieline' | 'bpando'>
  provider: ResearchProvider
  label: string
  domain: string
}

/** 单次最多取几篇（WP 上限 100；一篇一张题图，够用即可）。 */
const WORDPRESS_MAX_PER_PAGE = 20
/** 画廊用的题图尺寸：优先这几档（大图太重，缩略图太糊）。 */
const PREFERRED_SIZES = ['large', 'medium_large', '2048x2048', 'full', 'medium'] as const

export function wordpressSearchUrl(domain: string, query: string, perPage: number): string {
  const url = new URL(`https://${domain}/wp-json/wp/v2/posts`)
  url.searchParams.set('search', query)
  url.searchParams.set('orderby', 'relevance')
  url.searchParams.set('per_page', String(Math.max(1, Math.min(WORDPRESS_MAX_PER_PAGE, Math.floor(perPage)))))
  url.searchParams.set('_embed', 'wp:featuredmedia')
  url.searchParams.set('_fields', 'id,title,link,_links,_embedded')
  return url.toString()
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 站内地址：本站或其 `www.` / WordPress.com 图片 CDN（`i0.wp.com/<域名>/…`）。 */
function onSite(url: string, domain: string): boolean {
  if (!isPublicHttpUrl(url)) return false
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host === domain || host === `www.${domain}`) return true
    return /^i\d\.wp\.com$/.test(host) && parsed.pathname.startsWith(`/${domain}/`)
  } catch {
    return false
  }
}

export interface WordPressParseResult {
  /** 响应根本不是文章数组（拦截页 / 改版）。 */
  recognized: boolean
  items: DesignResearchItem[]
}

/** 解析 REST 文章数组 → 调研候选；没有题图、题图不在本站、（给了检索词时）题目不相关的文章跳过。 */
export function parseWordPressPosts(payload: unknown, spec: WordPressSiteSpec, queryIndex = 0, query = ''): WordPressParseResult {
  const keyTerms = queryKeyTerms(query)
  if (!Array.isArray(payload)) return { recognized: false, items: [] }
  const items: DesignResearchItem[] = []
  for (const raw of payload) {
    const post = recordOf(raw)
    const id = typeof post.id === 'number' ? post.id : Number(textOf(post.id)) || 0
    const link = textOf(post.link)
    if (!id || !onSite(link, spec.domain)) continue
    const media = recordOf((recordOf(post._embedded)['wp:featuredmedia'] as unknown[] | undefined)?.[0])
    if (textOf(media.media_type) && textOf(media.media_type) !== 'image') continue
    const details = recordOf(media.media_details)
    const sizes = recordOf(details.sizes)
    const candidates = [
      ...PREFERRED_SIZES.map((name) => textOf(recordOf(sizes[name]).source_url)),
      textOf(media.source_url),
    ].filter((url, index, all) => url && all.indexOf(url) === index && onSite(url, spec.domain))
    const [imageUrl, ...fallbacks] = candidates
    if (!imageUrl) continue
    const width = Number(details.width) || 0
    const height = Number(details.height) || 0
    const title = plainTitle(textOf(recordOf(post.title).rendered)) || `${spec.label} 文章`
    const about = `${title} ${plainTitle(textOf(media.alt_text))} ${plainTitle(textOf(recordOf(media.caption).rendered))}`
    if (!mentionsKeyTerm(about, keyTerms)) continue
    items.push({
      id: `${spec.id}:${queryIndex}:${id}`,
      source: spec.provider,
      title,
      url: link,
      imageUrl,
      ...(fallbacks.length > 0 ? { imageUrls: fallbacks } : {}),
      description: [spec.label, width > 0 && height > 0 ? `${width}×${height}` : ''].filter(Boolean).join(' · '),
    })
  }
  return { recognized: true, items }
}

export function wordpressAdapter(spec: WordPressSiteSpec): DirectSiteAdapter {
  return {
    kind: 'direct',
    id: spec.id,
    label: spec.label,
    domain: spec.domain,
    queryLanguage: 'en',
    async search(network, request, signal): Promise<SiteAdapterOutcome> {
      const base = { id: spec.id, label: spec.label }
      let payload: unknown
      try {
        const text = await fetchSiteText(network, wordpressSearchUrl(spec.domain, siteSearchQuery(request.query), Math.max(request.limit * 2, 10)), 'application/json', signal)
        payload = JSON.parse(text)
      } catch (error) {
        const status = error instanceof SyntaxError ? 'unrecognized' : siteFetchFailureOf(error)
        return { ...base, status, items: [], failureText: siteFailureText(spec.label, status) }
      }
      const parsed = parseWordPressPosts(payload, spec, request.queryIndex, request.query)
      const items = parsed.items.slice(0, Math.max(0, request.limit))
      if (items.length > 0) return { ...base, status: 'ok', items }
      const status = parsed.recognized ? 'empty' : 'unrecognized'
      return { ...base, status, items: [], failureText: siteFailureText(spec.label, status) }
    },
  }
}

export const theDielineAdapter = wordpressAdapter({ id: 'thedieline', provider: 'thedieline', label: 'The Dieline', domain: 'thedieline.com' })
export const bpandoAdapter = wordpressAdapter({ id: 'bpando', provider: 'bpando', label: 'BP&O', domain: 'bpando.org' })
