import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  useAgentPanelQueueMenu,
  type AgentPanelQueueMenuEnvironment,
  type AgentPanelQueueMenu,
} from './useAgentPanelQueueMenu'

function eventTarget() {
  const listeners = new Map<string, EventListener>()
  return {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener)
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type)
    }),
    dispatch: (type: string, event: object) => {
      listeners.get(type)?.(event as Event)
    },
    listeners,
  }
}

function renderMenu(
  sessionId = 's1',
  environment: AgentPanelQueueMenuEnvironment,
) {
  let current!: AgentPanelQueueMenu
  function Probe({ id }: { id: string }) {
    current = useAgentPanelQueueMenu(id, environment)
    return null
  }
  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(createElement(Probe, { id: sessionId }))
  })
  return {
    get: () => current,
    update: (id: string) =>
      act(() => {
        root.update(createElement(Probe, { id }))
      }),
    unmount: () => act(() => root.unmount()),
  }
}

describe('useAgentPanelQueueMenu', () => {
  it('打开后外部点击与 Esc 都能收起，并成对移除四条监听', () => {
    const documentTarget = eventTarget()
    const windowTarget = eventTarget()
    const hook = renderMenu('s1', {
      document: documentTarget,
      window: windowTarget,
    })

    act(() => hook.get().setQueueMenuId('turn-1'))
    expect(documentTarget.listeners.size).toBe(2)
    expect(windowTarget.listeners.size).toBe(2)
    act(() => {
      documentTarget.dispatch('pointerdown', {
        target: { closest: () => null },
      })
    })
    expect(hook.get().queueMenuId).toBeNull()

    act(() => hook.get().setQueueMenuId('turn-2'))
    act(() => {
      windowTarget.dispatch('keydown', { key: 'Escape' })
    })
    expect(hook.get().queueMenuId).toBeNull()
    expect(documentTarget.listeners.size).toBe(0)
    expect(windowTarget.listeners.size).toBe(0)
    hook.unmount()
  })

  it('切换会话时清空菜单 id 与坐标', () => {
    const hook = renderMenu('s1', {
      document: eventTarget(),
      window: eventTarget(),
    })
    act(() => {
      hook.get().setQueueMenuId('turn-1')
      hook.get().setQueueMenuPosition({ right: 12, bottom: 18 })
    })

    hook.update('s2')
    expect(hook.get().queueMenuId).toBeNull()
    expect(hook.get().queueMenuPosition).toBeNull()
    hook.unmount()
  })
})
