import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import { browserSiteItems, type BrowserSiteSpec } from './browserSites'
import { isPageSnapshot, pageExtractScript, parsePageSnapshot, type PageSnapshot } from './pageSnapshot'
import { classifyPageWall, type PageWall } from './pageWall'
import { siteFailureText } from './siteFetch'
import type {
  BrowserSiteContext,
  BrowserWallDecision,
  SiteAdapterOutcome,
  SiteSearchRequest,
} from './types'

/**
 * 在 Agent 后台浏览器里跑一个设计站（对账 #1087 / #1088，2026-11-13）：
 *
 * 1. 隐藏窗口打开站内搜索页 → 等加载 → 滚几屏 → 注入提取脚本 → 快照；
 * 2. 快照 → 站点规则过滤成调研候选；
 * 3. 识别墙：人机验证先**等它自己放行**（WAF / Sucuri / hashcash 在真实浏览器里多半几秒内自动过），
 *    最多等 3 轮；仍挡着、或是登录墙 ⇒ 把窗口亮给用户，界面提示「需要你处理一下验证/登录，
 *    完成后点继续」；用户点继续（或直接关掉那个窗口）就隐藏窗口、重新打开搜索页再提取；
 *    取消 ⇒ 本次应用运行期间不再为这个站打扰用户。
 * 4. 跑完关掉窗口（登录在共用数据目录里，下次仍在）。同一个站同一时刻只跑一份（窗口 id 固定）。
 */
const CHALLENGE_WAIT_MS = 4_000
const CHALLENGE_ROUNDS = 3
/** 同一次检索最多请用户处理几次。 */
const MAX_WALL_PROMPTS = 2

/** 本次应用运行期间用户选了「取消」的站：不再弹提示，直接记 needs-login / blocked。 */
const declinedSites = new Set<string>()
const siteLocks = new Map<string, Promise<unknown>>()

/** 测试用。 */
export function resetBrowserSiteState(): void {
  declinedSites.clear()
  siteLocks.clear()
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
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

class AbortedError extends Error {}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AbortedError('aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new AbortedError('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function withSiteLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = siteLocks.get(id) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(run)
  siteLocks.set(id, next)
  void next.finally(() => {
    if (siteLocks.get(id) === next) siteLocks.delete(id)
  }).catch(() => undefined)
  return next
}

interface Reading {
  snapshot: PageSnapshot | null
  items: DesignResearchItem[]
  wall: PageWall
}

/** 等用户处理：界面提示与「用户直接关掉窗口」谁先到算谁；结束时撤掉提示。 */
async function askUser(
  spec: BrowserSiteSpec,
  context: BrowserSiteContext,
  wall: PageWall,
  url: string,
  signal: AbortSignal,
): Promise<BrowserWallDecision> {
  const resolveWall = context.resolveWall
  if (!resolveWall) return 'cancel'
  const prompt = new AbortController()
  const stop = () => prompt.abort()
  signal.addEventListener('abort', stop, { once: true })
  let unsubscribe: () => void = () => undefined
  const closed = new Promise<BrowserWallDecision>((resolve) => {
    unsubscribe = context.browser.subscribe(spec.id, (event) => {
      if (event.kind === 'closed') resolve('continue')
    })
  })
  try {
    await context.browser.show(spec.id, `轻画 · ${spec.label}：${wall.kind === 'login' ? '请登录' : '请完成验证'}`)
    return await Promise.race([
      resolveWall(
        { siteId: spec.id, label: spec.label, kind: wall.kind === 'login' ? 'login' : 'challenge', reason: wall.reason, url },
        prompt.signal,
      ),
      closed,
    ])
  } finally {
    unsubscribe()
    prompt.abort()
    signal.removeEventListener('abort', stop)
    await context.browser.hide(spec.id).catch(() => undefined)
  }
}

export async function runBrowserSite(
  spec: BrowserSiteSpec,
  context: BrowserSiteContext,
  request: SiteSearchRequest,
  signal: AbortSignal,
): Promise<SiteAdapterOutcome> {
  return withSiteLock(spec.id, async () => {
    try {
      return await runUnlocked(spec, context, request, signal)
    } finally {
      await context.browser.close(spec.id).catch(() => undefined)
    }
  })
}

async function runUnlocked(
  spec: BrowserSiteSpec,
  context: BrowserSiteContext,
  request: SiteSearchRequest,
  signal: AbortSignal,
): Promise<SiteAdapterOutcome> {
  const base = { id: spec.id, label: spec.label }
  const sleep = context.sleep ?? defaultSleep
  const url = spec.searchUrl(request.query)
  const script = pageExtractScript(spec.extract)
  const limit = Math.max(1, request.limit)
  const read = (raw: string): Reading => {
    const parsed = parsePageSnapshot(raw)
    if (!isPageSnapshot(parsed)) return { snapshot: null, items: [], wall: { kind: 'none', reason: '' } }
    const items = browserSiteItems(spec, parsed, { queryIndex: request.queryIndex, searchUrl: url, limit })
    const wall = classifyPageWall(parsed, {
      requestedUrl: url,
      itemCount: items.length,
      ...(spec.gatedMeansLogin ? { gatedMeansLogin: true } : {}),
    })
    return { snapshot: parsed, items, wall }
  }
  const fail = (status: SiteAdapterOutcome['status'], items: DesignResearchItem[] = []): SiteAdapterOutcome => ({
    ...base,
    status: items.length > 0 ? 'ok' : status,
    items,
    ...(items.length > 0 ? {} : { failureText: siteFailureText(spec.label, status) }),
  })

  let prompts = 0
  let last: Reading | null = null
  try {
    for (;;) {
      let reading = read(await abortable(
        context.browser.load(spec.id, url, script, { scrollSteps: spec.scrollSteps ?? 3 }),
        signal,
      ))
      // 人机验证：先等它自己放行（页面会自己刷新），再在当前页重新提取
      for (let round = 0; round < CHALLENGE_ROUNDS && reading.wall.kind === 'challenge'; round += 1) {
        await sleep(CHALLENGE_WAIT_MS, signal)
        if (signal.aborted) throw new AbortedError('aborted')
        try {
          reading = read(await abortable(context.browser.snapshot(spec.id, script), signal))
        } catch (error) {
          if (error instanceof AbortedError) throw error
          // 页面正在刷新时脚本可能没响应，下一轮再看
        }
      }
      last = reading
      if (!reading.snapshot) return fail('unrecognized')
      if (reading.wall.kind === 'none') {
        return reading.items.length > 0
          ? { ...base, status: 'ok', items: reading.items }
          : fail('empty')
      }
      if (declinedSites.has(spec.id) || prompts >= MAX_WALL_PROMPTS || !context.resolveWall) break
      prompts += 1
      const decision = await askUser(spec, context, reading.wall, url, signal)
      if (signal.aborted) throw new AbortedError('aborted')
      if (decision === 'cancel') {
        declinedSites.add(spec.id)
        break
      }
    }
  } catch (error) {
    if (error instanceof AbortedError || signal.aborted) return fail('empty', last?.items ?? [])
    return fail('network')
  }
  const status = last?.wall.kind === 'login' ? 'needs-login' : 'blocked'
  // 被挡住时仍保留已经看到的那几张（Pinterest 未登录时的 gated pin）
  return fail(status, last?.items ?? [])
}
