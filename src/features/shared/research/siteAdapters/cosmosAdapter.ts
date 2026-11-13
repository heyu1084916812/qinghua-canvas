import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import { fetchSiteText, plainTitle, siteFailureText, siteFetchFailureOf } from './siteFetch'
import type { DirectSiteAdapter, SiteAdapterOutcome } from './types'

/**
 * Cosmos（cosmos.so，视觉灵感收藏站）直连适配器（2026-11-14）。
 *
 * 搜索页 `https://www.cosmos.so/search/elements/<词>` 是服务端渲染的 Next.js 页面，结果在页面内
 * Apollo 补水脚本 `(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({...})` 的
 * `rehydrate.<key>.data.searchElements.results[]` 里（一页 40 条；JS 字面量含 `undefined`，替换成 null 再解析）。
 * 实测：免登录、浏览器 UA 200；「tea packaging」40 条全是茶包装，「茶叶包装设计」也能按语义命中。
 * robots.txt 允许 `/search/…`（只禁带查询串的地址），所以词放在路径里。
 *
 * - 图：`element.media.url` 或 `multipleMedia[0].url`，都在 `cdn.cosmos.so/<uuid>`，免签名、不认 Referer；
 *   画廊用 `?format=jpeg&w=800`（实测 200），原图作备用。
 * - **跳过 `aiGenerated: true` 与非 `SAFE` 的图**：设计参考要真实作品。
 * - 标题：`generatedCaption.text`（去掉 `<n>` 高亮标签），没有时用原出处作者名；链接用 `shareUrl`（cosmos.so/e/<id>）。
 */
export const COSMOS_SEARCH_ENDPOINT = 'https://www.cosmos.so/search/elements/'
const COSMOS_LABEL = 'Cosmos'
const COSMOS_IMAGE = /^https:\/\/cdn\.cosmos\.so\/[0-9a-f-]{20,60}$/i
const COSMOS_SHARE = /^https:\/\/www\.cosmos\.so\/e\/\d+$/i
const APOLLO_PUSH = '(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push('

export function cosmosSearchUrl(query: string): string {
  // 路径段：空格与斜杠都转义（`encodeURIComponent` 已处理），不带查询串
  return `${COSMOS_SEARCH_ENDPOINT}${encodeURIComponent(query.trim())}`
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 页面里所有 Apollo 补水负载（解析失败的跳过）。 */
export function cosmosApolloPayloads(html: string): unknown[] {
  const out: unknown[] = []
  let from = 0
  for (;;) {
    const start = html.indexOf(APOLLO_PUSH, from)
    if (start < 0) break
    const end = html.indexOf(')</script>', start)
    if (end < 0) break
    from = end
    const literal = html.slice(start + APOLLO_PUSH.length, end).replace(/:\s*undefined(?=\s*[,}\]])/g, ':null')
    try {
      out.push(JSON.parse(literal))
    } catch {
      /* 不是纯 JSON 字面量：跳过 */
    }
  }
  return out
}

export interface CosmosParseResult {
  /** 找到了 `searchElements`（哪怕 0 条）；没有 = 被拦或改版。 */
  recognized: boolean
  items: DesignResearchItem[]
}

export function parseCosmosSearch(html: string, queryIndex = 0): CosmosParseResult {
  let results: unknown[] | null = null
  for (const payload of cosmosApolloPayloads(html)) {
    for (const entry of Object.values(recordOf(recordOf(payload).rehydrate))) {
      const list = recordOf(recordOf(recordOf(entry).data).searchElements).results
      if (Array.isArray(list)) results = [...(results ?? []), ...list]
    }
  }
  if (!results) return { recognized: false, items: [] }
  const items: DesignResearchItem[] = []
  const seen = new Set<string>()
  for (const raw of results) {
    const element = recordOf(recordOf(raw).element)
    const id = typeof element.id === 'number' ? element.id : 0
    const multiple = Array.isArray(element.multipleMedia) ? element.multipleMedia : []
    const media = recordOf(element.media ?? multiple[0] ?? multiple.find(Boolean))
    const original = textOf(media.url)
    if (!id || !COSMOS_IMAGE.test(original) || seen.has(original)) continue
    if (media.aiGenerated === true || (textOf(media.notSafeForWorkStatus) && textOf(media.notSafeForWorkStatus) !== 'SAFE')) continue
    const share = textOf(element.shareUrl)
    const url = COSMOS_SHARE.test(share) ? share : `https://www.cosmos.so/e/${id}`
    if (!isPublicHttpUrl(url)) continue
    seen.add(original)
    const source = recordOf(element.source)
    const author = plainTitle(textOf(recordOf(source.author).fullName) || textOf(recordOf(source.author).username))
    const caption = plainTitle(textOf(recordOf(element.generatedCaption).text))
    const width = Number(media.width) || 0
    const height = Number(media.height) || 0
    items.push({
      id: `cosmos:${queryIndex}:${id}`,
      source: 'cosmos',
      title: caption.length > 80 ? `${caption.slice(0, 80).trim()}…` : caption || (author ? `${author} 的收藏` : 'Cosmos 收藏'),
      url,
      imageUrl: `${original}?format=jpeg&w=800`,
      imageUrls: [original],
      description: [COSMOS_LABEL, width > 0 && height > 0 ? `${width}×${height}` : ''].filter(Boolean).join(' · '),
      ...(author ? { credit: author } : {}),
    })
  }
  return { recognized: true, items }
}

export const cosmosAdapter: DirectSiteAdapter = {
  kind: 'direct',
  id: 'cosmos',
  label: COSMOS_LABEL,
  domain: 'cosmos.so',
  async search(network, request, signal): Promise<SiteAdapterOutcome> {
    const base = { id: 'cosmos' as const, label: COSMOS_LABEL }
    let html: string
    try {
      html = await fetchSiteText(network, cosmosSearchUrl(request.query), 'text/html,application/xhtml+xml', signal)
    } catch (error) {
      const status = siteFetchFailureOf(error)
      return { ...base, status, items: [], failureText: siteFailureText(COSMOS_LABEL, status) }
    }
    const parsed = parseCosmosSearch(html, request.queryIndex)
    const items = parsed.items.slice(0, Math.max(0, request.limit))
    if (items.length > 0) return { ...base, status: 'ok', items }
    const status = parsed.recognized ? 'empty' : 'unrecognized'
    return { ...base, status, items: [], failureText: siteFailureText(COSMOS_LABEL, status) }
  },
}
