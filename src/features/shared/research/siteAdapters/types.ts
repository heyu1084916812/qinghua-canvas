import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import type { AgentBrowserPort } from '../../../../platform/agentBrowser'
import type { NetworkPort } from '../../../../platform/ports'

/**
 * 设计站点适配器（对账 #1076 方案 D，2026-11-13）：图片调研直接去设计站自己的搜索接口取图，
 * 不再经 Bing 图片搜索（Bing 图片接口在 `site:` 子句下不理查询词，只按域名过滤会把站内无关图当成功）。
 *
 * - `direct`：应用 HTTP 客户端直连可用（花瓣 JSON 接口、站酷搜索页 HTML），经桌面壳原生请求
 *   （publicOnly：公网校验、跟随系统代理）。
 * - `browser`：只在真实浏览器里能打开（Cloudflare / Sucuri / JS 渲染 / 需登录）：桌面壳经
 *   Agent 后台浏览器（隐藏 WebviewWindow，#1087）打开并提取；网页版没有这个端口，如实报 `needs-browser`。
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
  /** 需要真实浏览器（隐藏 webview）才能抓，当前环境没有（网页版）。 */
  | 'needs-browser'
  /** 站点要求登录，用户没有处理（取消 / 跳过）。 */
  | 'needs-login'
  /** 人机验证没有通过（用户没有处理或处理后仍被挡）。 */
  | 'blocked'

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

/**
 * 站内搜索认哪种语言的检索词：`en` = 英文站（中文词基本搜不到，先用模型给的英文角度）；
 * 缺省 / `any` = 按模型给的顺序。
 */
export type SiteQueryLanguage = 'en' | 'any'

/** 应用 HTTP 客户端可直连的站点。 */
export interface DirectSiteAdapter {
  kind: 'direct'
  id: SiteAdapterId
  label: string
  domain: string
  queryLanguage?: SiteQueryLanguage
  search: (
    network: NetworkPort,
    request: SiteSearchRequest,
    signal: AbortSignal,
  ) => Promise<SiteAdapterOutcome>
}

/** 遇到验证 / 登录墙时请用户处理的请求（#1088）。 */
export interface BrowserWallRequest {
  siteId: SiteAdapterId
  label: string
  kind: 'challenge' | 'login'
  /** 一句话原因（「需要登录」「弹出了人机验证」）。 */
  reason: string
  url: string
}

export type BrowserWallDecision = 'continue' | 'cancel'

/** 浏览器站点运行时：Agent 后台浏览器端口 + 可选的「请用户处理」回调。 */
export interface BrowserSiteContext {
  browser: AgentBrowserPort
  /**
   * 把验证 / 登录墙交给用户处理（界面提示「完成后点继续」）。`signal` 中止时提示要撤掉。
   * 缺省 = 不打扰用户，直接记 `blocked` / `needs-login`。
   */
  resolveWall?: (request: BrowserWallRequest, signal: AbortSignal) => Promise<BrowserWallDecision>
  /** 测试注入：等待验证页自动放行时的计时器。 */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * 只能在真实浏览器里抓的站点（经 Agent 后台浏览器实现，#1087）。
 * 没有浏览器端口（网页版）或 `search` 缺省时，调度层记 `needs-browser`，不发请求。
 */
export interface BrowserSiteAdapter {
  kind: 'browser'
  id: SiteAdapterId
  label: string
  domain: string
  /** 为什么只能走浏览器（实测原因，写进报告与状态）。 */
  reason: string
  queryLanguage?: SiteQueryLanguage
  search?: (
    context: BrowserSiteContext,
    request: SiteSearchRequest,
    signal: AbortSignal,
  ) => Promise<SiteAdapterOutcome>
}

export type SiteAdapter = DirectSiteAdapter | BrowserSiteAdapter
