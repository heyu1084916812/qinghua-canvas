import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  isBrowserViewId,
  roundBrowserViewBounds,
  type BrowserViewBounds,
  type BrowserViewEvent,
  type BrowserViewPort,
} from '../browserView'

/** Rust `browser_view.rs` 发到主窗口的事件名与载荷（`browser_view_rules::EVENT_NAME`） */
export const BROWSER_VIEW_EVENT = 'browser-view:event'

interface RawViewEvent {
  id: string
  kind: string
  url?: string
  title?: string
}

/** 把 Rust 的原始载荷收窄成端口事件；认不出的种类（如 `blocked`）丢掉 */
export function toBrowserViewEvent(raw: RawViewEvent): BrowserViewEvent | null {
  if (raw.kind === 'title') return { kind: 'title', title: raw.title ?? '' }
  if (!raw.url) return null
  if (raw.kind === 'loadStarted') return { kind: 'loadStarted', url: raw.url }
  if (raw.kind === 'loadFinished') return { kind: 'loadFinished', url: raw.url }
  if (raw.kind === 'navigated') return { kind: 'navigated', url: raw.url }
  return null
}

/**
 * 原生网页视图的壳实现（2026-11-13）：转发到 `browser_view_*` 命令。
 * 视图 id 先在前端校验一遍（Rust 侧还会再校验），坐标统一取整。
 */
export function createTauriBrowserView(): BrowserViewPort {
  const call = (command: string, id: string, args: Record<string, unknown> = {}) => {
    if (!isBrowserViewId(id)) return Promise.reject(new Error(`无效的浏览器视图 id：${id}`))
    return invoke<void>(command, { id, ...args })
  }
  const bounds = (value: BrowserViewBounds) => roundBrowserViewBounds(value)
  return {
    open: (id, options) => call('browser_view_open', id, {
      url: options.url,
      bounds: bounds(options.bounds),
      visible: options.visible ?? true,
    }),
    navigate: (id, url) => call('browser_view_navigate', id, { url }),
    back: (id) => call('browser_view_back', id),
    forward: (id) => call('browser_view_forward', id),
    reload: (id) => call('browser_view_reload', id),
    stop: (id) => call('browser_view_stop', id),
    setBounds: (id, value) => call('browser_view_set_bounds', id, { bounds: bounds(value) }),
    show: (id) => call('browser_view_show', id),
    hide: (id) => call('browser_view_hide', id),
    close: (id) => call('browser_view_close', id),
    subscribe(id, listener) {
      let disposed = false
      let unlisten: UnlistenFn | null = null
      void listen<RawViewEvent>(BROWSER_VIEW_EVENT, (event) => {
        if (event.payload.id !== id) return
        const mapped = toBrowserViewEvent(event.payload)
        if (mapped) listener(mapped)
      }).then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
      return () => {
        disposed = true
        unlisten?.()
      }
    },
  }
}
