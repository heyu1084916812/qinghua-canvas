import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import type { Node as RFNode } from '@xyflow/react'
import type { FlowNodeData } from './FlowNode'
import { PAN_ACTIVATE_PX, useFlowGestureWindow } from './useFlowGestureWindow'

type Gesture = ReturnType<typeof useFlowGestureWindow>

function flowNode(id: string, x: number, y: number): RFNode<FlowNodeData> {
  return {
    id,
    position: { x, y },
    width: 200,
    height: 160,
    data: {} as FlowNodeData,
  }
}

function renderGesture() {
  const surface = {
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
  }
  const surfaceRef = { current: surface as unknown as HTMLDivElement }
  const nodes = [flowNode('center', 0, 0), flowNode('far', 5000, 5000)]
  const result: { current: Gesture } = { current: undefined as unknown as Gesture }

  function Probe() {
    result.current = useFlowGestureWindow({ surfaceRef, nodes })
    return null
  }

  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(createElement(Probe))
  })
  const rerender = () =>
    act(() => {
      root.update(createElement(Probe))
    })

  return { result, rerender, surface }
}

function stubBrowserWindow() {
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void, delay: number) =>
      globalThis.setTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) =>
      globalThis.clearTimeout(timer),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useFlowGestureWindow', () => {
  it('keeps every node mounted while toggling the native pan marker', () => {
    stubBrowserWindow()
    const { result, rerender, surface } = renderGesture()

    act(() => result.current.beginMove({ type: 'mousedown' } as MouseEvent))
    rerender()
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual([
      'center',
      'far',
    ])
    expect(surface.setAttribute).toHaveBeenCalledWith('data-viewport-moving', 'true')
    expect(surface.setAttribute).toHaveBeenCalledWith('data-viewport-mode', 'pan')

    act(() => result.current.endMove())
    rerender()
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual([
      'center',
      'far',
    ])
    expect(surface.removeAttribute).toHaveBeenCalledWith('data-viewport-moving')
    expect(surface.removeAttribute).toHaveBeenCalledWith('data-viewport-mode')
  })

  it('keeps one wheel window across a burst and restores after 180ms idle', () => {
    vi.useFakeTimers()
    stubBrowserWindow()
    const { result, rerender, surface } = renderGesture()

    act(() => {
      result.current.beginMove({ type: 'wheel' } as MouseEvent)
      result.current.beginMove({ type: 'wheel' } as MouseEvent)
    })
    rerender()
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual([
      'center',
      'far',
    ])
    expect(surface.setAttribute).toHaveBeenCalledTimes(2)
    expect(surface.setAttribute).toHaveBeenCalledWith('data-viewport-mode', 'wheel')

    act(() => result.current.endMove())
    rerender()

    act(() => {
      vi.advanceTimersByTime(179)
    })
    rerender()
    expect(surface.removeAttribute).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    rerender()
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual([
      'center',
      'far',
    ])
    expect(surface.removeAttribute).toHaveBeenCalledWith('data-viewport-moving')
    expect(surface.removeAttribute).toHaveBeenCalledWith('data-viewport-mode')
  })
  it('does not enter the gesture fast path for a click without real movement', () => {
    stubBrowserWindow()
    const { result, surface } = renderGesture()
    const vp = { x: 10, y: 20, zoom: 1 }
    act(() => result.current.beginMove({ type: 'mousedown' } as MouseEvent, vp))
    act(() => result.current.move(null, { x: 12, y: 21, zoom: 1 }))
    expect(surface.setAttribute).not.toHaveBeenCalled()
    act(() => result.current.endMove())
    expect(surface.removeAttribute).not.toHaveBeenCalled()

    act(() => result.current.beginMove({ type: 'mousedown' } as MouseEvent, vp))
    act(() => result.current.move(null, { x: 10 + PAN_ACTIVATE_PX, y: 20, zoom: 1 }))
    expect(surface.setAttribute).toHaveBeenCalledWith('data-viewport-mode', 'pan')
    act(() => result.current.endMove())
    expect(surface.removeAttribute).toHaveBeenCalledWith('data-viewport-moving')
  })
})
