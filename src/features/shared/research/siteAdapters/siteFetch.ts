import type { NetworkPort } from '../../../../platform/ports'
import { asAppError } from '../../../../shared/result'
import type { SiteAdapterStatus } from './types'

/**
 * 站点适配器共用的抓取：一律 `publicOnly: true`（桌面壳 Rust 原生 HTTP，过公网 / 重定向校验、
 * 跟随系统代理）；带常见桌面浏览器 UA —— 实测花瓣图床对 `curl/*` UA 回 403，空 UA 与浏览器 UA 都放行。
 * 不带 Cookie、不带 Referer。
 */
export const SITE_BROWSER_HEADERS: Readonly<Record<string, string>> = {
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/130.0.0.0 Safari/537.36',
}

export type SiteFetchFailure = Extract<SiteAdapterStatus, 'rate-limited' | 'unavailable' | 'network'>

export class SiteFetchError extends Error {
  readonly failure: SiteFetchFailure
  constructor(failure: SiteFetchFailure, message: string) {
    super(message)
    this.failure = failure
  }
}

export function siteFetchFailureOf(error: unknown): SiteFetchFailure {
  if (error instanceof SiteFetchError) return error.failure
  const app = asAppError(error)
  if (app?.kind === 'http') return app.status === 429 ? 'rate-limited' : 'network'
  if (app?.kind === 'network' && app.detail === 'blocked') return 'unavailable'
  return 'network'
}

const FAILURE_TEXT: Record<SiteFetchFailure, string> = {
  'rate-limited': '请求过于频繁，被站点暂时限流',
  unavailable: '只在桌面应用里可用（需要本机原生网络请求）',
  network: '连不上，请检查网络或代理',
}

export function siteFailureText(label: string, status: SiteAdapterStatus): string {
  if (status === 'empty') return `${label}没有找到相关结果`
  if (status === 'unrecognized') return `${label}搜索结果无法识别（可能被拦截或页面改版）`
  if (status === 'needs-browser') return `${label}需要浏览器环境才能检索，暂未接入`
  if (status === 'ok') return ''
  return `${label}${FAILURE_TEXT[status]}`
}

export async function fetchSiteText(
  network: NetworkPort,
  url: string,
  accept: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await network.request(
    {
      url,
      method: 'GET',
      headers: { ...SITE_BROWSER_HEADERS, Accept: accept },
      publicOnly: true,
      timeoutMs: 15_000,
      maxResponseBytes: 4 * 1024 * 1024,
    },
    signal,
  )
  if (response.status === 429) throw new SiteFetchError('rate-limited', 'HTTP 429')
  if (response.status < 200 || response.status >= 300) {
    throw new SiteFetchError('network', `HTTP ${response.status}`)
  }
  return response.text()
}

/** 去掉高亮标签、解码常见实体、压空白。 */
export function plainTitle(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}
