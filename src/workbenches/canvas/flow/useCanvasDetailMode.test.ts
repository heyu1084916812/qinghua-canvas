import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { DETAIL_MODE_SETTLE_MS } from './detailMode'
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
  it('keeps picture nodes mounted until the zoom has settled', () => {
    vi.useFakeTimers()
    const { store, emit } = harness()
    const hook = renderHook(() => useCanvasDetailMode(store as never))
    const { result } = hook
    expect(result.current).toBe('full')

    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.1 })
    act(() => {
      emit()
      vi.advanceTimersByTime(10)
      emit()
    })
    expect(result.current).toBe('full')

    act(() => {
      vi.advanceTimersByTime(DETAIL_MODE_SETTLE_MS)
    })
    expect(result.current).toBe('coarse')
    hook.unmount()
    vi.useRealTimers()
  })

  it('cancels a pending mode swap when the gesture returns to the current band', () => {
    vi.useFakeTimers()
    const { store, emit } = harness()
    const hook = renderHook(() => useCanvasDetailMode(store as never))
    const { result } = hook
    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.1 })
    act(() => emit())
    expect(result.current).toBe('full')

    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 })
    act(() => {
      emit()
      vi.advanceTimersByTime(DETAIL_MODE_SETTLE_MS + 10)
    })
    expect(result.current).toBe('full')
    hook.unmount()
    vi.useRealTimers()
  })

  it('keeps the current mode while zoom is still changing, then settles once', () => {
    vi.useFakeTimers()
    const { store, emit } = harness()
    const hook = renderHook(() => useCanvasDetailMode(store as never))
    const { result } = hook
    const initialRenders = hook.renderCount()

    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.1 })
    act(() => emit())
    act(() => {
      vi.advanceTimersByTime(DETAIL_MODE_SETTLE_MS - 20)
    })

    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.09 })
    act(() => emit())
    act(() => {
      vi.advanceTimersByTime(DETAIL_MODE_SETTLE_MS - 1)
    })
    expect(result.current).toBe('full')
    expect(hook.renderCount()).toBe(initialRenders)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('coarse')
    expect(hook.renderCount()).toBe(initialRenders + 1)

    hook.unmount()
    vi.useRealTimers()
  })

  it('does not postpone the mode swap for pan-only viewport changes', () => {
    vi.useFakeTimers()
    const { store, emit } = harness()
    const hook = renderHook(() => useCanvasDetailMode(store as never))

    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.1 })
    act(() => emit())
    act(() => {
      vi.advanceTimersByTime(100)
    })

    store.getViewport.mockReturnValue({ x: 20, y: 30, zoom: 0.1 })
    act(() => emit())
    act(() => {
      vi.advanceTimersByTime(DETAIL_MODE_SETTLE_MS - 100)
    })
    expect(hook.result.current).toBe('coarse')

    hook.unmount()
    vi.useRealTimers()
  })
})
