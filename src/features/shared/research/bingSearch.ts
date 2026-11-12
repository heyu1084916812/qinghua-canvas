import {
  type DesignResearchItem,
  type ResearchMode,
} from '../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import type { NetworkPort } from '../../../platform/ports'
import { asAppError } from '../../../shared/result'
import {
  parseBingImageResults,
  parseBingWebResults,
  type BingImageHit,
  type BingPageStatus,
  type BingWebHit,
} from './bingResultParser'
import { designReferenceSiteQuery, isDesignReferenceUrl } from './designReferenceSites'

/**
 * 免 Key 联网搜索（2026-11-12 拍板的默认通道）：抓 Bing 网页 / 图片结果页并解析。
 *
 * - 请求一律 `publicOnly: true`：桌面壳经 Rust 原生 HTTP 发出（无 CORS，过公网校验、跟随系统代理）；
 *   浏览器开发模式下 publicOnly 失败关闭，本通道如实报“只在桌面应用可用”，由调用方回退。
 * - 查询拼 `(site:a OR site:b …)` 限定到 12 个固定设计站；Bing 对匿名请求可能忽略 `site:`，
 *   因此解析后**再按域名过滤一次**，绝不把指定站点以外的结果混进来。
 * - 尽力而为：验证码、限流、改版都会失败，失败原因写进 `failure`，不抛错。
 */
export const BING_WEB_ENDPOINT = 'https://www.bing.com/search'
export const BING_IMAGE_ENDPOINT = 'https://www.bing.com/images/search'

/** 与常见桌面 Edge 一致的请求头；没有 UA 时 Bing 会返回精简页或直接拦截。 */
const BING_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
}

export type BingFailure =
  | 'captcha'
  | 'rate-limited'
  | 'unavailable'
  | 'network'
  | 'unrecognized'
  | 'off-site'
  | 'empty'

export interface BingSearchResult {
  items: DesignResearchItem[]
  /** 没拿到任何可用结果时的主因；有结果时缺省。 */
  failure?: BingFailure
  /** 面向用户 / 模型的失败说明（不含请求细节）。 */
  failureText?: string
}

export interface BingSearchInput {
  queries: readonly string[]
  mode?: ResearchMode
  /** 站点限定；缺省为 12 个固定设计站。 */
  domains?: readonly string[]
}

const FAILURE_PRIORITY: readonly BingFailure[] = [
  'captcha',
  'rate-limited',
  'unavailable',
  'network',
  'unrecognized',
  'off-site',
  'empty',
]

const FAILURE_TEXT: Record<BingFailure, string> = {
  captcha: '免费搜索（Bing）要求人机验证，暂时用不了',
  'rate-limited': '免费搜索（Bing）请求过于频繁，被暂时限流',
  unavailable: '免费搜索只在桌面应用里可用（需要本机原生网络请求结果页）',
  network: '免费搜索（Bing）连不上，请检查网络或代理',
  unrecognized: 'Bing 结果页无法识别（可能被拦截或页面改版）',
  'off-site': 'Bing 返回的结果都不在固定设计站点内',
  empty: 'Bing 在固定设计站点里没有找到结果',
}

export function bingFailureText(failure: BingFailure): string {
  return FAILURE_TEXT[failure]
}

export function bingSearchUrl(kind: 'web' | 'image', query: string): string {
  const url = new URL(kind === 'web' ? BING_WEB_ENDPOINT : BING_IMAGE_ENDPOINT)
  url.searchParams.set('q', query)
  if (kind === 'web') {
    url.searchParams.set('count', '30')
  } else {
    url.searchParams.set('first', '1')
    url.searchParams.set('form', 'HDRSC2')
  }
  return url.toString()
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function failureOfError(error: unknown): BingFailure {
  const app = asAppError(error)
  if (app?.kind === 'http') return app.status === 429 ? 'rate-limited' : 'network'
  if (app?.kind === 'network' && app.detail === 'blocked') return 'unavailable'
  return 'network'
}

function failureOfStatus(status: BingPageStatus): BingFailure | null {
  if (status === 'captcha') return 'captcha'
  if (status === 'unrecognized') return 'unrecognized'
  if (status === 'empty') return 'empty'
  return null
}

/** 网页命中 → 候选（只留固定站点内的公开地址）。 */
export function bingWebItemsOf(hits: readonly BingWebHit[], queryIndex = 0): DesignResearchItem[] {
  return hits.flatMap((hit, index) => {
    if (!isPublicHttpUrl(hit.url) || !isDesignReferenceUrl(hit.url)) return []
    return [{
      id: `bing:${queryIndex}:web:${index}`,
      source: 'bing' as const,
      title: hit.title,
      url: hit.url,
      imageUrl: '',
      description: hit.snippet || hit.title,
      credit: hostOf(hit.url),
    }]
  })
}

/** 图片命中 → 候选：来源页（没有时看原图）必须在固定站点内；原图打不开时用 Bing 缩略图兜底。 */
export function bingImageItemsOf(hits: readonly BingImageHit[], queryIndex = 0): DesignResearchItem[] {
  return hits.flatMap((hit, index) => {
    const pageUrl = isPublicHttpUrl(hit.pageUrl) ? hit.pageUrl : ''
    const original = isPublicHttpUrl(hit.imageUrl) ? hit.imageUrl : ''
    const thumbnail = isPublicHttpUrl(hit.thumbnailUrl) ? hit.thumbnailUrl : ''
    const imageUrl = original || thumbnail
    if (!imageUrl) return []
    if (!isDesignReferenceUrl(pageUrl || original)) return []
    const host = hostOf(pageUrl || imageUrl)
    return [{
      id: `bing:${queryIndex}:image:${index}`,
      source: 'bing' as const,
      title: hit.title || `图片 · ${host}`,
      url: pageUrl || imageUrl,
      imageUrl,
      ...(thumbnail && thumbnail !== imageUrl ? { imageUrls: [thumbnail] } : {}),
      description: hit.description || hit.title || `来自 ${host} 的搜索图片`,
      credit: host,
    }]
  })
}

interface PageOutcome {
  items: DesignResearchItem[]
  failure: BingFailure | null
}

async function fetchPage(
  network: NetworkPort,
  kind: 'web' | 'image',
  query: string,
  queryIndex: number,
  signal: AbortSignal,
): Promise<PageOutcome> {
  let html: string
  try {
    const response = await network.request(
      {
        url: bingSearchUrl(kind, query),
        method: 'GET',
        headers: { ...BING_HEADERS },
        publicOnly: true,
        timeoutMs: 20_000,
        maxResponseBytes: 3 * 1024 * 1024,
      },
      signal,
    )
    if (response.status < 200 || response.status >= 300) {
      throw { kind: 'http', status: response.status }
    }
    html = await response.text()
  } catch (error) {
    return { items: [], failure: failureOfError(error) }
  }
  const parsed = kind === 'web' ? parseBingWebResults(html) : parseBingImageResults(html)
  const items = kind === 'web'
    ? bingWebItemsOf(parsed.hits as BingWebHit[], queryIndex)
    : bingImageItemsOf(parsed.hits as BingImageHit[], queryIndex)
  if (items.length > 0) return { items, failure: null }
  return {
    items,
    failure: parsed.hits.length > 0 ? 'off-site' : failureOfStatus(parsed.status) ?? 'empty',
  }
}

/** 每个检索角度按模式抓网页 / 图片结果页（并发），合并去重；全部落空时给出主因。 */
export async function searchBing(
  network: NetworkPort,
  input: BingSearchInput,
  signal: AbortSignal,
): Promise<BingSearchResult> {
  const queries = input.queries.map((query) => query.trim()).filter(Boolean).slice(0, 4)
  if (queries.length === 0) return { items: [], failure: 'empty', failureText: FAILURE_TEXT.empty }
  const mode = input.mode ?? 'image'
  const kinds: Array<'web' | 'image'> = mode === 'web' ? ['web'] : mode === 'image' ? ['image'] : ['web', 'image']
  const siteClause = designReferenceSiteQuery(input.domains)
  const jobs = queries.flatMap((query, queryIndex) =>
    kinds.map((kind) => fetchPage(network, kind, `${query} ${siteClause}`, queryIndex, signal)),
  )
  const outcomes = await Promise.all(jobs)
  const items: DesignResearchItem[] = []
  const seen = new Set<string>()
  for (const outcome of outcomes) {
    for (const item of outcome.items) {
      const key = item.imageUrl ? `img:${item.imageUrl}` : `url:${item.url}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  if (items.length > 0) return { items }
  const failures = new Set(outcomes.map((outcome) => outcome.failure).filter(Boolean))
  const failure = FAILURE_PRIORITY.find((candidate) => failures.has(candidate)) ?? 'empty'
  return { items, failure, failureText: FAILURE_TEXT[failure] }
}
