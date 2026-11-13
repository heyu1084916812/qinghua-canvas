import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../../platform/ports'
import { BROWSER_SITE_ADAPTERS } from './browserSiteAdapters'
import { huabanAdapter } from './huabanAdapter'
import { siteFailureText } from './siteFetch'
import type {
  BrowserSiteAdapter,
  BrowserSiteContext,
  DirectSiteAdapter,
  SiteAdapterOutcome,
  SiteAdapterStatus,
  SiteAdapterId,
} from './types'
import { zcoolAdapter } from './zcoolAdapter'

/** 图片调研默认直连的站点（顺序即合并时的轮转顺序）。 */
export const DIRECT_SITE_ADAPTERS: readonly DirectSiteAdapter[] = [huabanAdapter, zcoolAdapter]

/** 同一站点相邻两次请求的间隔（毫秒）：多个检索角度时不连发，降低被限流概率。 */
export const SITE_ADAPTER_DELAY_MS = 400

/** 这些失败说明同一站点再换检索角度也没用，立即停止该站。 */
const STOP_STATUSES: ReadonlySet<SiteAdapterStatus> = new Set(['rate-limited', 'unavailable', 'network', 'unrecognized'])

export interface SiteAdapterRunInput {
  queries: readonly string[]
  /** 本次图片目标总数；平均分给各直连站点。 */
  imageMaxResults: number
  /** 测试传 0。 */
  delayMs?: number
  direct?: readonly DirectSiteAdapter[]
  browser?: readonly BrowserSiteAdapter[]
  /** 桌面壳的 Agent 后台浏览器（#1087）；缺省 = 网页版，浏览器站点只记 `needs-browser`。 */
  browserContext?: BrowserSiteContext
}

export interface SiteAdapterRunStatus {
  id: SiteAdapterId
  label: string
  status: SiteAdapterStatus
  itemCount: number
  failureText?: string
}

export interface SiteAdapterRunResult {
  items: DesignResearchItem[]
  /** 实际产出结果的站点名（如 `['花瓣', '站酷']`），给步骤标签与提示词用。 */
  usedSources: string[]
  statuses: SiteAdapterRunStatus[]
  /** 直连站点全部落空时的原因（每站一句）；有结果时为空。 */
  failures: string[]
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

async function runOneSite(
  adapter: DirectSiteAdapter,
  network: NetworkPort,
  queries: readonly string[],
  target: number,
  delayMs: number,
  signal: AbortSignal,
): Promise<{ items: DesignResearchItem[]; outcome: SiteAdapterOutcome }> {
  const items: DesignResearchItem[] = []
  const seen = new Set<string>()
  let last: SiteAdapterOutcome = { id: adapter.id, label: adapter.label, status: 'empty', items: [] }
  for (const [queryIndex, query] of queries.entries()) {
    if (signal.aborted || items.length >= target) break
    if (queryIndex > 0) await waitFor(delayMs, signal)
    if (signal.aborted) break
    let outcome: SiteAdapterOutcome
    try {
      outcome = await adapter.search(network, { query, limit: target - items.length, queryIndex }, signal)
    } catch {
      outcome = { id: adapter.id, label: adapter.label, status: 'network', items: [], failureText: siteFailureText(adapter.label, 'network') }
    }
    last = outcome
    for (const item of outcome.items) {
      const key = item.imageUrl || item.url
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
    if (STOP_STATUSES.has(outcome.status)) break
  }
  const status: SiteAdapterStatus = items.length > 0 ? 'ok' : last.status
  return {
    items,
    outcome: {
      id: adapter.id,
      label: adapter.label,
      status,
      items,
      ...(status === 'ok' ? {} : { failureText: last.failureText ?? siteFailureText(adapter.label, status) }),
    },
  }
}

/** 浏览器站点每站至少要几张（一页搜索结果通常 20–40 张，取前若干）。 */
const BROWSER_SITE_MIN_TARGET = 8

/**
 * 直连站点在前、浏览器站点在后（#1087「花瓣 + 站酷之后」）。报告会按图片目标数截断，
 * 所以浏览器站点有结果时直连只占前一半名额，保证后面的站也能露面；剩下的再按原顺序补齐。
 */
export function mergeSiteItems(
  direct: readonly DesignResearchItem[],
  browser: readonly DesignResearchItem[],
  total: number,
): DesignResearchItem[] {
  const directQuota = browser.length > 0 ? Math.min(direct.length, Math.ceil(Math.max(1, total) / 2)) : direct.length
  const browserQuota = Math.min(browser.length, Math.max(0, total - directQuota))
  return [
    ...direct.slice(0, directQuota),
    ...browser.slice(0, browserQuota),
    ...direct.slice(directQuota),
    ...browser.slice(browserQuota),
  ]
}

async function runBrowserAdapter(
  adapter: BrowserSiteAdapter,
  context: BrowserSiteContext,
  queries: readonly string[],
  target: number,
  signal: AbortSignal,
): Promise<SiteAdapterOutcome> {
  let last: SiteAdapterOutcome = { id: adapter.id, label: adapter.label, status: 'empty', items: [] }
  // 一页搜索结果就够多：先用第一个检索角度，没有命中再换第二个
  for (const [queryIndex, query] of queries.slice(0, 2).entries()) {
    if (signal.aborted || !adapter.search) break
    try {
      last = await adapter.search(context, { query, limit: target, queryIndex }, signal)
    } catch {
      last = { id: adapter.id, label: adapter.label, status: 'network', items: [], failureText: siteFailureText(adapter.label, 'network') }
    }
    if (last.status !== 'empty') break
  }
  return last
}

/** 轮转合并：花瓣 1、站酷 1、花瓣 2…，让画廊前几格就能看到两个站。 */
function interleave(lists: readonly DesignResearchItem[][]): DesignResearchItem[] {
  const out: DesignResearchItem[] = []
  const longest = Math.max(0, ...lists.map((list) => list.length))
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const item = list[i]
      if (item) out.push(item)
    }
  }
  return out
}

/**
 * 并发跑直连站点（各站内部按检索角度顺序请求、够数即停）；有 Agent 后台浏览器时浏览器站点同时开跑
 * （#1087），没有就只记 `needs-browser`。
 * 不做相关性闸门：结果来自站点自己的搜索，相关性由站点负责（#1076 实测花瓣 / 站酷命中正常）。
 */
export async function runSiteAdapters(
  network: NetworkPort,
  input: SiteAdapterRunInput,
  signal: AbortSignal,
): Promise<SiteAdapterRunResult> {
  const queries = input.queries.map((query) => query.trim()).filter(Boolean).slice(0, 4)
  const direct = input.direct ?? DIRECT_SITE_ADAPTERS
  const browser = input.browser ?? BROWSER_SITE_ADAPTERS
  const target = Math.max(1, Math.ceil(Math.max(1, input.imageMaxResults) / Math.max(1, direct.length)))
  const browserContext = input.browserContext
  const browserTarget = Math.max(BROWSER_SITE_MIN_TARGET, Math.ceil(Math.max(1, input.imageMaxResults) / Math.max(1, browser.length)))
  // 浏览器站点与直连站点同时开跑（各开一个隐藏窗口）；合并时排在直连之后
  const browserRunsPromise = browserContext && queries.length > 0
    ? Promise.all(browser.map((adapter) => runBrowserAdapter(adapter, browserContext, queries, browserTarget, signal)))
    : null
  const runs = queries.length === 0
    ? direct.map((adapter) => ({
        items: [] as DesignResearchItem[],
        outcome: { id: adapter.id, label: adapter.label, status: 'empty' as const, items: [], failureText: siteFailureText(adapter.label, 'empty') },
      }))
    : await Promise.all(
        direct.map((adapter) =>
          runOneSite(adapter, network, queries, target, input.delayMs ?? SITE_ADAPTER_DELAY_MS, signal),
        ),
      )
  const directItems = interleave(runs.map((run) => run.items))
  const browserRuns = browserRunsPromise ? await browserRunsPromise : null
  const browserItems = interleave((browserRuns ?? []).map((outcome) => outcome.items))
  const items = mergeSiteItems(directItems, browserItems, input.imageMaxResults)
  const statuses: SiteAdapterRunStatus[] = [
    ...runs.map(({ outcome }) => ({
      id: outcome.id,
      label: outcome.label,
      status: outcome.status,
      itemCount: outcome.items.length,
      ...(outcome.failureText ? { failureText: outcome.failureText } : {}),
    })),
    ...(browserRuns
      ? browserRuns.map((outcome) => ({
          id: outcome.id,
          label: outcome.label,
          status: outcome.status,
          itemCount: outcome.items.length,
          ...(outcome.failureText ? { failureText: outcome.failureText } : {}),
        }))
      : browser.map((adapter) => ({
          id: adapter.id,
          label: adapter.label,
          status: 'needs-browser' as const,
          itemCount: 0,
          failureText: `${siteFailureText(adapter.label, 'needs-browser')}（${adapter.reason}）`,
        }))),
  ]
  return {
    items,
    usedSources: [
      ...runs.filter((run) => run.items.length > 0).map((run) => run.outcome.label),
      ...(browserRuns ?? []).filter((outcome) => outcome.items.length > 0).map((outcome) => outcome.label),
    ],
    statuses,
    failures: items.length > 0
      ? []
      : [
          ...runs.map(({ outcome }) => outcome.failureText ?? siteFailureText(outcome.label, outcome.status)),
          ...(browserRuns ?? []).map((outcome) => outcome.failureText ?? siteFailureText(outcome.label, outcome.status)),
        ],
  }
}
