import { useEffect, useRef, useState, type RefObject } from 'react'
import type { BrowserNavAction, BrowserNavState } from '../../../domain/canvas/browserNavigation'
import {
  CANVAS_BROWSER_VIEW_ID,
  roundBrowserViewBounds,
  sameBrowserViewBounds,
  type BrowserViewBounds,
  type BrowserViewPort,
} from '../../../platform/browserView'
import { domBrowserOccluder } from './browserOcclusion'

/**
 * 把画布浏览器的内容区交给原生 webview（2026-11-13）。
 *
 * - **跟随**：内容区的 DOM 矩形就是原生视图的位置；ResizeObserver + 窗口 resize +
 *   每 400ms 兜底轮询（侧栏收起这类只改位置不改尺寸的变化 ResizeObserver 看不到），
 *   都只在矩形真的变了时发 `setBounds`，用 rAF 合并同一帧的多次变化。
 * - **让位**：原生层永远在 DOM 之上，起始页 / 错误态 / 有 DOM 浮层压上来时 `hide`。
 * - **导航**：用户动作在这里转成命令；页面自己的跳转由 Rust 的加载事件回填到 reducer。
 *
 * 返回 `covered`：被浮层盖住、正在让位（内容区显示一行占位说明）。
 */
export function useNativeBrowserView({
  port,
  state,
  url,
  dispatch,
  contentRef,
  rootRef,
}: {
  port: BrowserViewPort | undefined
  state: BrowserNavState
  url: string
  dispatch: (action: BrowserNavAction) => void
  contentRef: RefObject<HTMLElement | null>
  rootRef: RefObject<HTMLElement | null>
}) {
  const id = CANVAS_BROWSER_VIEW_ID
  const openedRef = useRef(false)
  const loadedUrlRef = useRef('')
  const boundsRef = useRef<BrowserViewBounds | null>(null)
  const shownRef = useRef<boolean | null>(null)
  const [covered, setCovered] = useState(false)
  const wantsVisible = state.phase === 'loading' || state.phase === 'loaded'

  // 事件回填
  useEffect(() => {
    if (!port) return
    return port.subscribe(id, (event) => {
      if (event.kind === 'title') dispatch({ type: 'title', title: event.title })
      else if (event.kind === 'loadFinished') dispatch({ type: 'loaded', url: event.url })
      else dispatch({ type: 'committed', url: event.url })
      if (event.kind !== 'title') loadedUrlRef.current = event.url
    })
  }, [dispatch, id, port])

  // 关闭画布浏览器 / 离开画布页时销毁视图（登录在磁盘上，下次打开仍在）
  useEffect(() => {
    if (!port) return
    return () => {
      openedRef.current = false
      void port.close(id).catch(() => undefined)
    }
  }, [id, port])

  // 主动跳转：revision 变化 = 用户发起了 go / back / forward / reload
  const revisionRef = useRef(-1)
  const lastActionRef = useRef<'go' | 'back' | 'forward' | 'reload'>('go')
  useEffect(() => {
    if (!port || !url || state.phase !== 'loading' || revisionRef.current === state.revision) return
    revisionRef.current = state.revision
    const content = contentRef.current
    if (!content) return
    const bounds = measure(content)
    const action = lastActionRef.current
    lastActionRef.current = 'go'
    if (!openedRef.current) {
      openedRef.current = true
      boundsRef.current = bounds
      shownRef.current = true
      void port.open(id, { url, bounds }).catch((error: unknown) => {
        openedRef.current = false
        dispatch({ type: 'failed', message: `打开网页失败：${messageOf(error)}` })
      })
      return
    }
    const run = action === 'back'
      ? port.back(id)
      : action === 'forward'
        ? port.forward(id)
        : action === 'reload' && loadedUrlRef.current === url
          ? port.reload(id)
          : port.navigate(id, url)
    void run.catch((error: unknown) => dispatch({ type: 'failed', message: messageOf(error) }))
  }, [contentRef, dispatch, id, port, state.phase, state.revision, url])

  // 跟随位置 + 遮挡判定
  useEffect(() => {
    if (!port) return
    let frame = 0
    const sync = () => {
      frame = 0
      const content = contentRef.current
      if (!content || !openedRef.current) return
      const occluder = domBrowserOccluder(content, rootRef.current)
      const next = measure(content)
      const visible = wantsVisible && !occluder && next.width > 0 && next.height > 0
      setCovered(wantsVisible && Boolean(occluder))
      if (visible && !sameBrowserViewBounds(boundsRef.current, next)) {
        boundsRef.current = next
        void port.setBounds(id, next).catch(() => undefined)
      }
      if (shownRef.current !== visible) {
        shownRef.current = visible
        void (visible ? port.show(id) : port.hide(id)).catch(() => undefined)
      }
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(sync)
    }
    schedule()
    const resize = new ResizeObserver(schedule)
    if (contentRef.current) resize.observe(contentRef.current)
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'open', 'role'],
    })
    window.addEventListener('resize', schedule)
    const poll = window.setInterval(schedule, 400)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      window.clearInterval(poll)
    }
  }, [contentRef, id, port, rootRef, wantsVisible])

  return {
    native: Boolean(port),
    covered,
    /** 在 dispatch back / forward / reload 之前调用，告诉下一次跳转该走哪条命令 */
    markAction(action: 'back' | 'forward' | 'reload') {
      lastActionRef.current = action
    },
    stop() {
      if (port && openedRef.current) void port.stop(id).catch(() => undefined)
    },
  }
}

function measure(element: HTMLElement): BrowserViewBounds {
  const rect = element.getBoundingClientRect()
  return roundBrowserViewBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
