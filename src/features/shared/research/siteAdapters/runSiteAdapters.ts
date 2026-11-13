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
  SiteQueryLanguage,
} from './types'
import { zcoolAdapter } from './zcoolAdapter'

/** 图片调研默认直连的站点（顺序即合并时的轮转顺序）。 */
export const DIRECT_SITE_ADAPTERS: readonly DirectSiteAdapter[] = [huabanAdapter, zcoolAdapter]

/** 同一站点相邻两次请求的间隔（毫秒）：多个检索角度时不连发，降低被限流概率。 */
export const SITE_ADAPTER_DELAY_MS = 400

/**
 * 每站时限（2026-11-14 live-run bug 1）：到点就叫停这个站，交出已经拿到的结果，不让一个慢站拖住整次调研。
 * 直连站：一次请求 15s 上限，最多 4 个角度；浏览器站：加载 + 等验证放行 + 一次请用户处理（提示自身 45s 超时）。
 */
export const DIRECT_SITE_DEADLINE_MS = 30_000
export const BROWSER_SITE_DEADLINE_MS = 70_000
/**
 * 其它站都跑完后，还在等用户处理验证 / 登录的站最多再等多久；到点撤掉提示，按 needs-login / blocked 记，
 * 先把花瓣 / 站酷等已经拿到的结果交出去（用户可以之后在画布浏览器里登录，下次检索带登录态）。
 */
export const WALL_GRACE_MS = 15_000

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
  /** 测试注入：每站时限与等用户的宽限（毫秒）。 */
  deadlines?: { direct?: number; browser?: number; wallGrace?: number }
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

/** 子信号：父信号中止或本站到点都中止；`timedOut()` 区分是不是时限到了。 */
function siteSignal(parent: AbortSignal, deadlineMs: number): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController()
  let expired = false
  const onAbort = () => controller.abort()
  parent.addEventListener('abort', onAbort, { once: true })
  if (parent.aborted) controller.abort()
  const timer = setTimeout(() => {
    expired = true
    controller.abort()
  }, Math.max(0, deadlineMs))
  return {
    signal: controller.signal,
    timedOut: () => expired,
    done: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onAbort)
    },
  }
}

function slowText(label: string): string {
  return `${label}响应太慢，这次先跳过`
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

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

/**
 * 给一个站排检索角度（2026-11-14）：英文站把模型给的英文角度排前面（中文词在 POTW / Dieline 基本搜不到；
 * 离线没有翻译，只能用模型给的英文角度），没有英文角度就照原顺序（第一个角度打头）。
 */
export function queriesForSite(queries: readonly string[], language: SiteQueryLanguage = 'any'): string[] {
  if (language !== 'en') return [...queries]
  const english = queries.filter((query) => !CJK.test(query))
  return english.length > 0 ? [...english, ...queries.filter((query) => CJK.test(query))] : [...queries]
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
  // 一页搜索结果就够多：先用第一个检索角度（英文站优先英文角度），没有命中再换第二个
  for (const [queryIndex, query] of queriesForSite(queries, adapter.queryLanguage).slice(0, 2).entries()) {
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
  const directDeadline = input.deadlines?.direct ?? DIRECT_SITE_DEADLINE_MS
  const browserDeadline = input.deadlines?.browser ?? BROWSER_SITE_DEADLINE_MS
  const wallGrace = input.deadlines?.wallGrace ?? WALL_GRACE_MS

  // 所有站同时开跑，各自带时限；谁也不等谁（Promise.allSettled 语义：单站出错只影响它自己）。
  const tasks: Promise<unknown>[] = []
  const othersSettled = (self: Promise<unknown>) =>
    Promise.allSettled(tasks.filter((task) => task !== self)).then(() => undefined)

  const directRuns = queries.length === 0
    ? direct.map((adapter) => Promise.resolve({
        items: [] as DesignResearchItem[],
        outcome: { id: adapter.id, label: adapter.label, status: 'empty' as const, items: [], failureText: siteFailureText(adapter.label, 'empty') } as SiteAdapterOutcome,
      }))
    : direct.map(async (adapter) => {
        const site = siteSignal(signal, directDeadline)
        try {
          const run = await runOneSite(adapter, network, queriesForSite(queries, adapter.queryLanguage), target, input.delayMs ?? SITE_ADAPTER_DELAY_MS, site.signal)
          if (site.timedOut() && run.items.length === 0) {
            return { items: run.items, outcome: { ...run.outcome, status: 'network' as const, failureText: slowText(adapter.label) } }
          }
          return run
        } finally {
          site.done()
        }
      })
  tasks.push(...directRuns)

  const browserRuns = browserContext && queries.length > 0
    ? browser.map((adapter) => {
        const site = siteSignal(signal, browserDeadline)
        let self: Promise<SiteAdapterOutcome> = Promise.resolve(null as unknown as SiteAdapterOutcome)
        const outerResolve = browserContext.resolveWall
        // 等用户处理时：其它站都跑完再宽限 WALL_GRACE_MS，到点撤掉提示（按取消处理）
        const context: BrowserSiteContext = outerResolve
          ? {
              ...browserContext,
              resolveWall: (request, promptSignal) => {
                const prompt = new AbortController()
                const stop = () => prompt.abort()
                promptSignal.addEventListener('abort', stop, { once: true })
                if (promptSignal.aborted) prompt.abort()
                let graceTimer: ReturnType<typeof setTimeout> | undefined
                void othersSettled(self).then(() => {
                  graceTimer = setTimeout(stop, Math.max(0, wallGrace))
                })
                return outerResolve(request, prompt.signal).finally(() => {
                  if (graceTimer) clearTimeout(graceTimer)
                  promptSignal.removeEventListener('abort', stop)
                })
              },
            }
          : browserContext
        self = (async () => {
          try {
            const outcome = await runBrowserAdapter(adapter, context, queries, browserTarget, site.signal)
            if (site.timedOut() && outcome.items.length === 0 && (outcome.status === 'empty' || outcome.status === 'network')) {
              return { ...outcome, status: 'network' as const, failureText: slowText(adapter.label) }
            }
            return outcome
          } finally {
            site.done()
          }
        })()
        return self
      })
    : null
  if (browserRuns) tasks.push(...browserRuns)

  const runs = await Promise.all(directRuns)
  const browserOutcomes = browserRuns ? await Promise.all(browserRuns) : null
  const directItems = interleave(runs.map((run) => run.items))
  const browserItems = interleave((browserOutcomes ?? []).map((outcome) => outcome.items))
  const items = mergeSiteItems(directItems, browserItems, input.imageMaxResults)
  const statusOf = (outcome: SiteAdapterOutcome): SiteAdapterRunStatus => ({
    id: outcome.id,
    label: outcome.label,
    status: outcome.status,
    itemCount: outcome.items.length,
    ...(outcome.failureText ? { failureText: outcome.failureText } : {}),
  })
  const statuses: SiteAdapterRunStatus[] = [
    ...runs.map(({ outcome }) => statusOf(outcome)),
    ...(browserOutcomes
      ? browserOutcomes.map(statusOf)
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
    // 只有 `ok` 的站算「搜到了」（被验证 / 登录挡住的站即使留了零星条目也不算）
    usedSources: statuses.filter((status) => status.status === 'ok' && status.itemCount > 0).map((status) => status.label),
    statuses,
    failures: items.length > 0
      ? []
      : [
          ...runs.map(({ outcome }) => outcome.failureText ?? siteFailureText(outcome.label, outcome.status)),
          ...(browserOutcomes ?? []).map((outcome) => outcome.failureText ?? siteFailureText(outcome.label, outcome.status)),
        ],
  }
}
