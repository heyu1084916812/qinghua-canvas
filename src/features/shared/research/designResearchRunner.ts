import type { InspirationCase } from '../../../domain/inspiration/cases'
import { filterCases } from '../../../domain/inspiration/cases'
import {
  buildDesignResearchReport,
  extractOpenGraphImages,
  MAX_RESEARCH_URLS,
  normalizeResearchRequest,
  parsePinterestHtml,
  type ResearchMode,
  type DesignResearchItem,
  type DesignResearchReport,
  type ResearchProvider,
  type WebSearchSettings,
} from '../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../platform/ports'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { errorTextOf } from '../../../shared/result'
import { TAVILY_KEY_MISSING_MESSAGE } from './tavilySearch'
import { searchFixedDesignSites } from './fixedSiteSearch'

export interface DesignResearchRunnerInput {
  topic: string
  urls?: readonly string[]
  maxResults?: number
  /** 图片 / 网页 / 图文混合；缺省由关键词推断，找图片请求默认 image。 */
  mode?: ResearchMode
  /** 图片模式独立目标数量；不会占用 maxResults 的网页条数。 */
  imageMaxResults?: number
  /** Clipper 等单页抓取只读用户给出的 URL，不额外做开放图片/百科搜索。 */
  includeOpenSearch?: boolean
  /** 模型给出的 1–4 个检索角度（可含英文）；缺省时用 topic。 */
  queries?: readonly string[]
}

export interface DesignResearchRunnerDeps {
  network: NetworkPort
  libraryCases?: readonly InspirationCase[]
  webSearch?: WebSearchSettings
  /** 用户在设置里填的 Tavily Key（可选）：只在免费通道失败时使用，只进请求头，绝不回传。 */
  tavilyApiKey?: string | null
  /** 站点适配器同站相邻请求间隔（毫秒）；缺省 400，测试传 0。 */
  siteAdapterDelayMs?: number
}

export interface DesignResearchResult extends DesignResearchReport {
  ok: boolean
  warnings: string[]
  /** 已填的 Tavily Key 被拒或额度用尽：模型应如实告诉用户去设置里处理。没填 Key 不算。 */
  needsTavilyKey?: boolean
  /** 需要用户处理的问题（目前只有已填 Tavily Key 无效 / 额度用尽）。 */
  error?: string
  /** 联网搜索实际产出结果的来源名（如 `['花瓣', '站酷']`）；没联网搜索或全空时缺省。 */
  usedSources?: string[]
}

/** 规范化检索角度：去空、去重、最多 4 个；没有就用主题本身。 */
export function researchQueriesOf(topic: string, queries?: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of queries ?? []) {
    const query = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
    if (query && !out.includes(query)) out.push(query)
    if (out.length >= 4) break
  }
  return out.length > 0 ? out : [topic.trim()].filter(Boolean)
}

function providerOf(url: string): ResearchProvider {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'pinterest.com' || host.endsWith('.pinterest.com')) return 'pinterest'
    if (host === 'behance.net' || host.endsWith('.behance.net')) return 'behance'
    if (host === 'google.com' || host.endsWith('.google.com')) return 'google'
    return 'web'
  } catch {
    return 'web'
  }
}

function pageTitle(html: string, pageUrl: string): string {
  const title =
    /<meta\b[^>]*\bproperty=["']og:title["'][^>]*\bcontent=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bproperty=["']og:title["']/i.exec(html)?.[1] ??
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ??
    ''
  const cleaned = title
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned) return cleaned
  try {
    const url = new URL(pageUrl)
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname)
  } catch {
    return pageUrl
  }
}

function itemId(source: ResearchProvider, pageUrl: string, imageUrl: string, index: number): string {
  let marker = ''
  try {
    const url = new URL(pageUrl)
    marker = `${url.pathname}${imageUrl ? `|${imageUrl}` : ''}`
  } catch {
    marker = `${pageUrl}|${imageUrl}`
  }
  let hash = 0x811c9dc5
  for (let i = 0; i < marker.length; i += 1) {
    hash ^= marker.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${source}:${(hash >>> 0).toString(36)}:${index}`
}

function pageItems(html: string, pageUrl: string): DesignResearchItem[] {
  const provider = providerOf(pageUrl)
  if (provider === 'pinterest') {
    const pins = parsePinterestHtml(html, pageUrl)
    if (pins.length > 0) {
      return pins.map((item) =>
        isPublicHttpUrl(item.imageUrl) ? item : { ...item, imageUrl: '' },
      )
    }
  }

  const title = pageTitle(html, pageUrl)
  const images = extractOpenGraphImages(html, pageUrl)
    .filter((imageUrl) => isPublicHttpUrl(imageUrl))
    .slice(0, 6)
  if (images.length > 0) {
    return images.map((imageUrl, index) => ({
      id: itemId(provider, pageUrl, imageUrl, index),
      source: provider,
      title,
      url: pageUrl,
      imageUrl,
    }))
  }

  return [
    {
      id: itemId(provider, pageUrl, '', 0),
      source: provider,
      title,
      url: pageUrl,
      imageUrl: '',
    },
  ]
}

function libraryItems(
  cases: readonly InspirationCase[],
  topic: string,
  limit: number,
): DesignResearchItem[] {
  return filterCases(cases, { query: topic })
    .slice(0, limit)
    .map((item, index) => ({
      id: `web:library:${item.id}:${index}`,
      source: 'web',
      title: item.title,
      url: item.creditUrl || item.docUrl || item.imageUrl || item.id,
      imageUrl: isPublicHttpUrl(item.imageUrl) ? item.imageUrl : '',
    }))
}

export async function runDesignResearch(
  input: DesignResearchRunnerInput,
  deps: DesignResearchRunnerDeps,
  signal: AbortSignal,
): Promise<DesignResearchResult> {
  const request = normalizeResearchRequest(input.topic, input.urls, input.maxResults, {
    mode: input.mode,
    imageMaxResults: input.imageMaxResults,
  })
  const warnings: string[] = []
  if ((input.urls?.length ?? 0) > MAX_RESEARCH_URLS) {
    warnings.push(`一次最多读取 ${MAX_RESEARCH_URLS} 个公开页面，多出的 URL 已忽略。`)
  }
  const safeUrls: string[] = []
  for (const url of request.urls) {
    if (isPublicHttpUrl(url)) safeUrls.push(url)
    else warnings.push(`${url} 不是公开互联网地址，已跳过。`)
  }
  /** 排序：用户给的 URL → 设计站（图片走花瓣 / 站酷适配器，网页走 Bing；落空时可选 Tavily）→ 本地灵感库。 */
  const searchItems: DesignResearchItem[] = []
  let needsTavilyKey = false
  let usedSources: string[] = []
  if (input.includeOpenSearch !== false) {
    const web = await searchFixedDesignSites(
      deps,
      {
        queries: researchQueriesOf(request.topic, input.queries),
        maxResults: request.maxResults,
        mode: request.mode,
        imageMaxResults: request.imageMaxResults,
      },
      signal,
    )
    searchItems.push(...web.items)
    warnings.push(...web.warnings)
    needsTavilyKey = web.needsTavilyKey
    usedSources = web.usedSources
  }
  const libraryLimit = request.mode === 'web'
    ? Math.min(request.maxResults, 12)
    : Math.max(request.imageMaxResults, Math.min(request.maxResults, 12))
  searchItems.push(...libraryItems(deps.libraryCases ?? [], request.topic, libraryLimit))
  const items: DesignResearchItem[] = []

  const pages = await Promise.allSettled(
    safeUrls.map(async (url) => {
      const response = await deps.network.request(
        {
          url,
          method: 'GET',
          headers: {
            Accept: 'text/html,application/xhtml+xml',
          },
          publicOnly: true,
          maxResponseBytes: 8 * 1024 * 1024,
          timeoutMs: 30_000,
        },
        signal,
      )
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}`)
      }
      const html = await response.text()
      if (html.length > 8 * 1024 * 1024) {
        throw new Error('公开页面超过 8MB，已跳过')
      }
      return pageItems(html, response.finalUrl ?? url)
    }),
  )

  for (const [index, result] of pages.entries()) {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
    } else {
      warnings.push(
        `${safeUrls[index] ?? '公开页面'} 读取失败：${errorTextOf(result.reason)}`,
      )
    }
  }
  items.push(...searchItems)

  if (items.length === 0) {
    warnings.push(
      input.includeOpenSearch === false
        ? '页面没有提供可用的 Open Graph 图片或文章内容。'
        : '联网搜索没有找到可用参考；可以换个角度或英文关键词再搜，或补充公开网页 URL。',
    )
  }

  const report = buildDesignResearchReport({
    request: { ...request, urls: safeUrls },
    items,
  })
  return {
    ok: !signal.aborted && report.totalItems > 0,
    ...report,
    warnings,
    ...(usedSources.length > 0 ? { usedSources } : {}),
    ...(needsTavilyKey
      ? {
          needsTavilyKey: true,
          error: warnings.find((warning) => /Tavily (拒绝|本月)/.test(warning)) ?? TAVILY_KEY_MISSING_MESSAGE,
        }
      : {}),
  }
}
