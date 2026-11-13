import { useCallback, useEffect, useReducer } from 'react'
import {
  browserNavReducer,
  currentBrowserUrl,
  INITIAL_BROWSER_NAV,
  type BrowserNavAction,
  type BrowserNavState,
} from '../../../domain/canvas/browserNavigation'

/** 加载超过这么久仍没结束，就进入错误态（给出重试 / 系统浏览器打开） */
export const BROWSER_LOAD_TIMEOUT_MS = 20_000

export interface CanvasBrowserNav {
  state: BrowserNavState
  url: string
  dispatch: (action: BrowserNavAction) => void
}

/**
 * 导航状态 + 加载超时（2026-11-13）。不关心后端是 iframe 还是原生 webview：
 * 后端只负责把「commit / loaded / title」喂回来，这里统一出 UI 要的状态。
 */
export function useCanvasBrowserNav(initialUrl: string): CanvasBrowserNav {
  const [state, rawDispatch] = useReducer(
    browserNavReducer,
    initialUrl,
    (url): BrowserNavState => (url
      ? browserNavReducer(INITIAL_BROWSER_NAV, { type: 'go', url })
      : INITIAL_BROWSER_NAV),
  )
  const dispatch = useCallback((action: BrowserNavAction) => rawDispatch(action), [])

  useEffect(() => {
    if (state.phase !== 'loading') return
    const timer = window.setTimeout(() => {
      rawDispatch({
        type: 'failed',
        message: '网页长时间没有响应。可能是网络问题，或者这个站点不允许在画布里打开。',
      })
    }, BROWSER_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [state.phase, state.revision])

  return { state, url: currentBrowserUrl(state), dispatch }
}
