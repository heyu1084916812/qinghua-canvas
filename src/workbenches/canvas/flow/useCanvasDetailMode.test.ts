import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { DETAIL_MODE_SETTLE_MS } from './detailMode'
import { useCanvasDetailMode } from './useCanvasDetailMode'

function renderHook<T>(hook: () => T) {
  const result: { current: T } = { current: undefined as T }
  function Probe() {
    result.current = hook()
    return null
  }
  act(() => {
    TestRenderer.create(createElement(Probe))
  })
  return { result }
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
    const { result } = renderHook(() => useCanvasDetailMode(store as never))
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
    vi.useRealTimers()
  })

  it('cancels a pending mode swap when the gesture returns to the current band', () => {
    vi.useFakeTimers()
    const { store, emit } = harness()
    const { result } = renderHook(() => useCanvasDetailMode(store as never))
    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 0.1 })
    act(() => emit())
    expect(result.current).toBe('full')

    store.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 })
    act(() => {
      emit()
      vi.advanceTimersByTime(DETAIL_MODE_SETTLE_MS + 10)
    })
    expect(result.current).toBe('full')
    vi.useRealTimers()
  })
})
