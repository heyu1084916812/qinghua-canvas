/**
 * 画布浏览器的导航状态（纯 reducer，2026-11-13）。
 *
 * 两个后端共用：
 * - 原生 webview（桌面壳）：前进 / 后退交给 webview 自己的 history，但它不回报
 *   「能不能后退」，所以由这里按 `committed` 事件记一份历史栈；
 * - iframe 回退（浏览器开发版）：跨域 iframe 读不到 history，前进 / 后退就是在
 *   这份栈里移动指针、重新设 `src`。
 *
 * `committed` 的合并规则：用户主动发起的跳转（go / back / forward / reload）之后
 * 收到的**第一次** commit 视为这次跳转的落点（覆盖当前条目，吸收 http→https、
 * 末尾斜杠这类重定向）；之后再来的 commit 是页面自己跳的（点链接），压栈。
 */
export type BrowserPhase = 'blank' | 'loading' | 'loaded' | 'error'

export interface BrowserNavState {
  entries: string[]
  index: number
  phase: BrowserPhase
  title: string
  /** 出错时给用户看的一句话；phase !== 'error' 时为空 */
  error: string
  /** 主动跳转后还没收到第一次 commit */
  awaitingCommit: boolean
  /** 每次主动跳转 +1：iframe 用它做 key 强制重载 */
  revision: number
}

export type BrowserNavAction =
  | { type: 'go'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'stop' }
  | { type: 'committed'; url: string }
  | { type: 'loaded'; url?: string }
  | { type: 'title'; title: string }
  | { type: 'failed'; message: string }
  | { type: 'home' }

export const INITIAL_BROWSER_NAV: BrowserNavState = {
  entries: [],
  index: -1,
  phase: 'blank',
  title: '',
  error: '',
  awaitingCommit: false,
  revision: 0,
}

export function currentBrowserUrl(state: BrowserNavState): string {
  return state.entries[state.index] ?? ''
}

export function canGoBack(state: BrowserNavState): boolean {
  return state.index > 0
}

export function canGoForward(state: BrowserNavState): boolean {
  return state.index >= 0 && state.index < state.entries.length - 1
}

function startLoad(state: BrowserNavState, entries: string[], index: number): BrowserNavState {
  return {
    ...state,
    entries,
    index,
    phase: 'loading',
    title: '',
    error: '',
    awaitingCommit: true,
    revision: state.revision + 1,
  }
}

export function browserNavReducer(
  state: BrowserNavState,
  action: BrowserNavAction,
): BrowserNavState {
  switch (action.type) {
    case 'go': {
      const kept = state.entries.slice(0, state.index + 1)
      if (kept[kept.length - 1] === action.url) {
        return startLoad(state, kept, kept.length - 1)
      }
      return startLoad(state, [...kept, action.url], kept.length)
    }
    case 'back':
      return canGoBack(state) ? startLoad(state, state.entries, state.index - 1) : state
    case 'forward':
      return canGoForward(state) ? startLoad(state, state.entries, state.index + 1) : state
    case 'reload':
      return state.index >= 0 ? startLoad(state, state.entries, state.index) : state
    case 'stop':
      return state.phase === 'loading'
        ? { ...state, phase: 'loaded', awaitingCommit: false }
        : state
    case 'committed': {
      if (!action.url || action.url === currentBrowserUrl(state)) {
        return {
          ...state,
          phase: state.phase === 'error' ? 'error' : 'loading',
          awaitingCommit: false,
        }
      }
      if (state.awaitingCommit && state.index >= 0) {
        const entries = [...state.entries]
        entries[state.index] = action.url
        return { ...state, entries, phase: 'loading', awaitingCommit: false }
      }
      const kept = state.entries.slice(0, state.index + 1)
      return {
        ...state,
        entries: [...kept, action.url],
        index: kept.length,
        phase: 'loading',
        title: '',
        error: '',
        awaitingCommit: false,
      }
    }
    case 'loaded': {
      const next = action.url ? browserNavReducer(state, { type: 'committed', url: action.url }) : state
      if (next.phase === 'error' || next.index < 0) return next
      return { ...next, phase: 'loaded', awaitingCommit: false }
    }
    case 'title':
      return { ...state, title: action.title }
    case 'failed':
      return { ...state, phase: 'error', error: action.message, awaitingCommit: false }
    case 'home':
      return { ...INITIAL_BROWSER_NAV, revision: state.revision + 1 }
    default:
      return state
  }
}
