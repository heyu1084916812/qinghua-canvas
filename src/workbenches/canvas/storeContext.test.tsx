import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import type { Viewport } from '../../domain/canvas/geometry/coords'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { CanvasStoreProvider, useViewportStateWhen } from './storeContext'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function viewportStore(initial: Viewport) {
  const listeners = new Set<() => void>()
  let viewport = initial
  const store = {
    subscribeViewport(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getViewport: () => viewport,
  } as unknown as CanvasStore
  return {
    store,
    listeners,
    setViewport(next: Viewport) {
      viewport = next
      for (const listener of listeners) listener()
    },
  }
}

describe('useViewportStateWhen', () => {
  it('hidden panels do not subscribe until they become visible', () => {
    const fixture = viewportStore({ x: 10, y: 20, zoom: 1 })
    let renders = 0
    let latest: Viewport | null = null

    function Probe({ enabled }: { enabled: boolean }) {
      latest = useViewportStateWhen(enabled)
      renders += 1
      return null
    }

    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(
        <CanvasStoreProvider store={fixture.store}>
          <Probe enabled={false} />
        </CanvasStoreProvider>,
      )
    })

    expect(renders).toBe(1)
    expect(fixture.listeners.size).toBe(0)
    expect(latest).toMatchObject({ x: 0, y: 0, zoom: 1 })

    act(() => fixture.setViewport({ x: 30, y: 40, zoom: 2 }))
    expect(renders).toBe(1)
    expect(latest).toMatchObject({ x: 0, y: 0, zoom: 1 })

    act(() => {
      root.update(
        <CanvasStoreProvider store={fixture.store}>
          <Probe enabled />
        </CanvasStoreProvider>,
      )
    })
    expect(fixture.listeners.size).toBe(1)
    expect(latest).toMatchObject({ x: 30, y: 40, zoom: 2 })

    act(() => fixture.setViewport({ x: 50, y: 60, zoom: 0.5 }))
    expect(renders).toBe(3)
    expect(latest).toMatchObject({ x: 50, y: 60, zoom: 0.5 })

    act(() => root.unmount())
    expect(fixture.listeners.size).toBe(0)
  })
})
