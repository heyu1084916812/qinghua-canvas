import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import type { Node as RFNode } from '@xyflow/react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { FlowNodeData } from './FlowNode'
import { useFlowGestureWindow } from './useFlowGestureWindow'

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
  const store = {
    getViewport: vi.fn(() => ({ x: 0, y: 0, zoom: 1 })),
    getSurfaceSize: vi.fn(() => ({ w: 1000, h: 800 })),
  } as unknown as CanvasStore
  const nodes = [flowNode('center', 0, 0), flowNode('far', 5000, 5000)]
  const result: { current: Gesture } = { current: undefined as unknown as Gesture }

  function Probe() {
    result.current = useFlowGestureWindow({ store, surfaceRef, nodes })
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

  return { result, rerender, store, surface }
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
  it('windows nodes for pan and restores the full graph on release', () => {
    stubBrowserWindow()
    const { result, rerender, surface } = renderGesture()

    act(() => result.current.beginMove({ type: 'mousedown' } as MouseEvent))
    rerender()
    expect(result.current.moving).toBe(true)
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual(['center'])
    expect(surface.setAttribute).toHaveBeenCalledWith('data-viewport-moving', 'true')

    act(() => result.current.endMove())
    rerender()
    expect(result.current.moving).toBe(false)
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual([
      'center',
      'far',
    ])
    expect(surface.removeAttribute).toHaveBeenCalledWith('data-viewport-moving')
  })

  it('keeps one wheel window across a burst and restores after 180ms idle', () => {
    vi.useFakeTimers()
    stubBrowserWindow()
    const { result, rerender, store, surface } = renderGesture()

    act(() => {
      result.current.beginMove({ type: 'wheel' } as MouseEvent)
      result.current.beginMove({ type: 'wheel' } as MouseEvent)
    })
    rerender()
    expect(store.getViewport).toHaveBeenCalledTimes(1)
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual(['center'])
    expect(surface.setAttribute).toHaveBeenCalledTimes(1)

    act(() => result.current.endMove())
    rerender()
    expect(result.current.moving).toBe(true)

    act(() => {
      vi.advanceTimersByTime(179)
    })
    rerender()
    expect(result.current.moving).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    rerender()
    expect(result.current.moving).toBe(false)
    expect(result.current.renderedNodes.map((node) => node.id)).toEqual([
      'center',
      'far',
    ])
    expect(surface.removeAttribute).toHaveBeenCalledWith('data-viewport-moving')
  })
})
