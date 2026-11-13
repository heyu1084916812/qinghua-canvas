import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../../platform/ports'

/**
 * 设计站点适配器（对账 #1076 方案 D，2026-11-13）：图片调研直接去设计站自己的搜索接口取图，
 * 不再经 Bing 图片搜索（Bing 图片接口在 `site:` 子句下不理查询词，只按域名过滤会把站内无关图当成功）。
 *
 * - `direct`：应用 HTTP 客户端直连可用（花瓣 JSON 接口、站酷搜索页 HTML），经桌面壳原生请求
 *   （publicOnly：公网校验、跟随系统代理）。
 * - `browser`：只在真实浏览器里能打开（Cloudflare / Sucuri / JS 渲染 / 需登录），留待隐藏 webview 实现；
 *   目前只声明接口并如实报 `needs-browser`，不发请求。
 */
export type SiteAdapterId = 'huaban' | 'zcool' | 'dribbble' | 'thedieline' | 'packagingoftheworld' | 'pinterest'

export type SiteAdapterStatus =
  /** 拿到了结果。 */
  | 'ok'
  /** 请求成功但站内没有命中。 */
  | 'empty'
  /** 页面 / 接口结构认不出（改版或被拦截页）。 */
  | 'unrecognized'
  /** 429 或站点限流。 */
  | 'rate-limited'
  /** 只在桌面应用可用（浏览器开发模式下 publicOnly 失败关闭）。 */
  | 'unavailable'
  /** 连不上 / 超时 / 非 2xx。 */
  | 'network'
  /** 需要真实浏览器（隐藏 webview）才能抓，尚未实现。 */
  | 'needs-browser'

export interface SiteAdapterOutcome {
  id: SiteAdapterId
  /** 面向用户的站名（花瓣 / 站酷 …）。 */
  label: string
  status: SiteAdapterStatus
  items: DesignResearchItem[]
  /** 失败时的一句话说明（不含请求细节）。 */
  failureText?: string
}

export interface SiteSearchRequest {
  query: string
  /** 本次希望拿到的条数上限（适配器可少给，不可多给）。 */
  limit: number
  /** 第几个检索角度，用于生成稳定 id。 */
  queryIndex: number
}

/** 应用 HTTP 客户端可直连的站点。 */
export interface DirectSiteAdapter {
  kind: 'direct'
  id: SiteAdapterId
  label: string
  domain: string
  search: (
    network: NetworkPort,
    request: SiteSearchRequest,
    signal: AbortSignal,
  ) => Promise<SiteAdapterOutcome>
}

/**
 * 只能在真实浏览器里抓的站点（以后经隐藏 webview 实现）。
 * `search` 缺省 = 还没实现，调度层直接记 `needs-browser`，不发请求。
 */
export interface BrowserSiteAdapter {
  kind: 'browser'
  id: SiteAdapterId
  label: string
  domain: string
  /** 为什么只能走浏览器（实测原因，写进报告与状态）。 */
  reason: string
  search?: (
    request: SiteSearchRequest,
    signal: AbortSignal,
  ) => Promise<SiteAdapterOutcome>
}

export type SiteAdapter = DirectSiteAdapter | BrowserSiteAdapter
