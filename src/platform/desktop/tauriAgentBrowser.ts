import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { AgentBrowserPort } from '../agentBrowser'
import { isBrowserViewId } from '../browserView'

/** Rust `agent_browser_rules::AGENT_EVENT_NAME`。 */
export const AGENT_BROWSER_EVENT = 'agent-browser:event'

interface RawAgentEvent {
  id: string
  kind: string
}

/**
 * Agent 后台浏览器的壳实现（2026-11-13，#1087）：转发到 `agent_browser_*` 命令。
 * id 与画布浏览器视图同一套字符集，先在前端校验一遍（Rust 侧还会再校验）。
 */
export function createTauriAgentBrowser(): AgentBrowserPort {
  const call = <T>(command: string, id: string, args: Record<string, unknown> = {}) => {
    if (!isBrowserViewId(id)) return Promise.reject(new Error(`无效的 Agent 浏览器 id：${id}`))
    return invoke<T>(command, { id, ...args })
  }
  return {
    load: (id, url, script, options) => call<string>('agent_browser_load', id, { url, script, options: options ?? null }),
    snapshot: (id, script) => call<string>('agent_browser_snapshot', id, { script }),
    show: (id, title) => call<void>('agent_browser_show', id, { title: title ?? null }),
    hide: (id) => call<void>('agent_browser_hide', id),
    close: (id) => call<void>('agent_browser_close', id),
    subscribe(id, listener) {
      let disposed = false
      let unlisten: UnlistenFn | null = null
      void listen<RawAgentEvent>(AGENT_BROWSER_EVENT, (event) => {
        if (event.payload.id !== id) return
        if (event.payload.kind === 'closed') listener({ kind: 'closed' })
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
