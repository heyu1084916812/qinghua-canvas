import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import { fetchSiteText, plainTitle, siteFailureText, siteFetchFailureOf } from './siteFetch'
import { mentionsKeyTerm, queryKeyTerms, siteSearchQuery } from './siteRelevance'
import type { DirectSiteAdapter, SiteAdapterOutcome } from './types'

/**
 * Lovely Package（lovelypackage.com，包装设计博客）直连适配器（2026-11-14）。
 *
 * 站点的 WordPress REST 接口对外 403，只能读搜索结果页 `https://lovelypackage.com/?s=<词>`（浏览器 UA 200）。
 * Elementor 模板：每条结果是 `<article id="post-<id>" class="elementor-post …">`，题图
 * `img.attachment-large`（`/wp-content/uploads/…`），标题 `h1.elementor-heading-title > a`（文章地址）。
 * 中文词没有结果 ⇒ `queryLanguage: 'en'`。一页 10 条，每次检索只发一个请求；结果过 `siteRelevance` 的题目相关性闸门
 * （「tea packaging」会混进「Beef & Steak」）。
 */
export const LOVELY_PACKAGE_ORIGIN = 'https://lovelypackage.com'
const LOVELY_LABEL = 'Lovely Package'
const LOVELY_IMAGE = /^https:\/\/(?:www\.)?lovelypackage\.com\/wp-content\/uploads\/[^"'\s]+\.(?:jpe?g|png|webp)$/i
const LOVELY_POST = /^https:\/\/(?:www\.)?lovelypackage\.com\/[a-z0-9][a-z0-9-]*\/?$/i

export function lovelyPackageSearchUrl(query: string): string {
  const url = new URL(`${LOVELY_PACKAGE_ORIGIN}/`)
  url.searchParams.set('s', query.trim())
  return url.toString()
}

function attr(tag: string, name: string): string {
  return new RegExp(`\\b${name}=["']([^"']*)["']`, 'i').exec(tag)?.[1]?.replace(/&amp;/g, '&').trim() ?? ''
}

export interface LovelyPackageParseResult {
  /** 页面上有文章列表（`<article … elementor-post>`）或明确的「没有结果」；都没有 = 被拦或改版。 */
  recognized: boolean
  items: DesignResearchItem[]
}

export function parseLovelyPackageSearch(html: string, queryIndex = 0, query = ''): LovelyPackageParseResult {
  const keyTerms = queryKeyTerms(query)
  const articles = html.match(/<article\b[^>]*\bid=["']post-\d+["'][\s\S]*?<\/article>/gi) ?? []
  const recognized = articles.length > 0 || /elementor-posts-nothing-found|nothing found|no results/i.test(html)
  const items: DesignResearchItem[] = []
  const seen = new Set<string>()
  for (const article of articles) {
    const postId = /\bid=["']post-(\d+)["']/i.exec(article)?.[1] ?? ''
    const heading = /<h\d\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i.exec(article)
    const link = heading ? attr(heading[1] ?? '', 'href') : ''
    const title = plainTitle(heading?.[2] ?? '')
    const image = (article.match(/<img\b[^>]*>/gi) ?? [])
      .map((tag) => attr(tag, 'src'))
      .find((src) => LOVELY_IMAGE.test(src)) ?? ''
    if (!postId || !LOVELY_POST.test(link) || !isPublicHttpUrl(link) || !image || seen.has(link)) continue
    if (!mentionsKeyTerm(title, keyTerms)) continue
    seen.add(link)
    // 搜索页用 1024 宽的「large」档；去掉尺寸后缀就是原图，作备用
    const original = image.replace(/-\d{2,4}x\d{2,4}(\.[a-z]+)$/i, '$1')
    items.push({
      id: `lovelypackage:${queryIndex}:${postId}`,
      source: 'lovelypackage',
      title: title || `${LOVELY_LABEL} 作品`,
      url: link,
      imageUrl: image,
      ...(original !== image ? { imageUrls: [original] } : {}),
      description: LOVELY_LABEL,
    })
  }
  return { recognized, items }
}

export const lovelyPackageAdapter: DirectSiteAdapter = {
  kind: 'direct',
  id: 'lovelypackage',
  label: LOVELY_LABEL,
  domain: 'lovelypackage.com',
  queryLanguage: 'en',
  async search(network, request, signal): Promise<SiteAdapterOutcome> {
    const base = { id: 'lovelypackage' as const, label: LOVELY_LABEL }
    let html: string
    try {
      html = await fetchSiteText(network, lovelyPackageSearchUrl(siteSearchQuery(request.query)), 'text/html,application/xhtml+xml', signal)
    } catch (error) {
      const status = siteFetchFailureOf(error)
      return { ...base, status, items: [], failureText: siteFailureText(LOVELY_LABEL, status) }
    }
    const parsed = parseLovelyPackageSearch(html, request.queryIndex, request.query)
    const items = parsed.items.slice(0, Math.max(0, request.limit))
    if (items.length > 0) return { ...base, status: 'ok', items }
    const status = parsed.recognized ? 'empty' : 'unrecognized'
    return { ...base, status, items: [], failureText: siteFailureText(LOVELY_LABEL, status) }
  },
}
