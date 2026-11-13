import type { BrowserWallDecision, BrowserWallRequest } from './siteAdapters/types'

/**
 * 「需要你处理一下验证/登录」的待办（对账 #1088，2026-11-13）。
 *
 * Agent 调研跑在对话回合里，提示卡挂在画布舞台上：两边不在一棵子树，用一个模块级小 store
 * 交接（与 `researchSelection` 同一套路）。每条待办对应一个已经亮出来的 Agent 浏览器窗口：
 * 用户点「继续」= 处理完了，重新提取；点「取消」= 这次不处理。调研被停止（`signal` 中止）时
 * 待办自动撤掉、按取消处理。只在内存里。
 */
export interface BrowserWallPrompt extends BrowserWallRequest {
  /** 本条待办的 id（同一站点可能先后出现多次）。 */
  key: string
}

interface Entry {
  prompt: BrowserWallPrompt
  resolve: (decision: BrowserWallDecision) => void
}

let entries: Entry[] = []
let snapshot: readonly BrowserWallPrompt[] = []
const listeners = new Set<() => void>()
let seq = 0

function emit() {
  snapshot = entries.map((entry) => entry.prompt)
  for (const listener of listeners) listener()
}

function settle(key: string, decision: BrowserWallDecision) {
  const entry = entries.find((row) => row.prompt.key === key)
  if (!entry) return
  entries = entries.filter((row) => row !== entry)
  emit()
  entry.resolve(decision)
}

/** 调研侧：挂一条待办，等用户点「继续 / 取消」。 */
export function requestBrowserWall(
  request: BrowserWallRequest,
  signal: AbortSignal,
): Promise<BrowserWallDecision> {
  if (signal.aborted) return Promise.resolve('cancel')
  seq += 1
  const key = `wall-${seq}`
  return new Promise<BrowserWallDecision>((resolve) => {
    entries = [...entries, { prompt: { ...request, key }, resolve }]
    emit()
    signal.addEventListener('abort', () => settle(key, 'cancel'), { once: true })
  })
}

/** 界面侧：用户的回答。 */
export function answerBrowserWall(key: string, decision: BrowserWallDecision): void {
  settle(key, decision)
}

export const browserWallStore = {
  get: (): readonly BrowserWallPrompt[] => snapshot,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  /** 测试用。 */
  reset() {
    entries = []
    seq = 0
    emit()
  },
}

/** 提示卡文案（「需要你处理一下验证/登录，完成后点继续」+ 站点与原因）。 */
export const BROWSER_WALL_HEADLINE = '需要你处理一下验证/登录，完成后点继续'

export function browserWallDetail(prompt: Pick<BrowserWallRequest, 'label' | 'kind' | 'reason'>): string {
  const what = prompt.kind === 'login' ? '登录' : '验证'
  return `${prompt.label}${prompt.reason ? ` ${prompt.reason}` : ''}。已在单独的窗口打开 ${prompt.label}，${what}完成后回到这里点「继续」，Agent 会接着找图；不想处理就点「取消」，这个站这次先跳过。`
}
