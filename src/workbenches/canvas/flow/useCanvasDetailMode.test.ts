import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useCanvasDetailMode } from './useCanvasDetailMode'

function renderHook<T>(hook: () => T) {
  const result: { current: T } = { current: undefined as T }
  let renders = 0
  function Probe() {
    result.current = hook()
    renders += 1
    return null
  }
  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(createElement(Probe))
  })
  return {
    result,
    renderCount: () => renders,
    unmount: () => act(() => root.unmount()),
  }
}

function harness(zoom = 1) {
  const listeners = new Set<() => void>()
  const store = {
    getViewport: vi.fn(() => ({ x: 0, y: 0, zoom })),
    subscribeViewport: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
  }
  const emit = () => {
    for (const listener of listeners) listener()
  }
  return { store, emit }
}

describe('useCanvasDetailMode', () => {
  it('keeps the real-thumbnail mode at every supported zoom', () => {
    const { store } = harness()
    const hook = renderHook(() => useCanvasDetailMode(store as never))
    expect(hook.result.current).toBe('full')
    hook.unmount()
  })

  it('does not subscribe to viewport updates or trigger extra renders', () => {
    const { store, emit } = harness(0.1)
    const hook = renderHook(() => useCanvasDetailMode(store as never))
    const initialRenders = hook.renderCount()

    act(() => emit())
    expect(hook.result.current).toBe('full')
    expect(hook.renderCount()).toBe(initialRenders)
    expect(store.subscribeViewport).not.toHaveBeenCalled()
    hook.unmount()
  })
})
