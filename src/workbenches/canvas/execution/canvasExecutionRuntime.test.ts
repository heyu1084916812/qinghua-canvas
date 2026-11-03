import {
  createElement,
  useEffect,
} from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore } from '../../../state/workbenches/canvas/store'
import {
  CanvasStoreProvider,
} from '../storeContext'
import { PlatformProvider } from '../../../app/providers/PlatformProvider'
import { ChannelStoreProvider } from '../../../app/providers/ChannelStoreProvider'
import {
  CanvasExecutionProvider,
  createCanvasExecutionHostAdapter,
  useCanvasExecution,
  type CanvasExecutionApi,
} from './CanvasExecutionProvider'
import {
  canvasExecutionRuntimeFor,
  disposeAllCanvasExecutionRuntimes,
  initializeCanvasExecutionVersions,
  nextCanvasExecutionVersion,
} from './canvasExecutionRuntime'
import {
  resetCanvasRunStatesForTests,
  updateCanvasRunState,
} from './canvasRunState'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  resetCanvasRunStatesForTests()
  await disposeAllCanvasExecutionRuntimes()
  vi.unstubAllGlobals()
})

describe('canvas per-project execution runtime', () => {
  it('provider 卸载后 live nodeStates / isRunning 仍更新，旧 cancel 仍能中止计划', async () => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      innerWidth: 1440,
      innerHeight: 900,
    })
    const platform = createMemoryPlatform()
    const store = createCanvasStore({
      platform,
      projectId: 'p1',
      debounceMs: 0,
    })
    let adapter: CanvasExecutionApi | null = null

    function Probe() {
      const execution = useCanvasExecution()
      useEffect(() => {
        adapter = createCanvasExecutionHostAdapter('p1', execution)
      }, [execution])
      return null
    }

    let root!: TestRenderer.ReactTestRenderer
    await act(async () => {
      root = TestRenderer.create(
        createElement(
          PlatformProvider,
          { runtime: 'memory' },
          createElement(
            ChannelStoreProvider,
            null,
            createElement(
              CanvasStoreProvider,
              {
                store,
                children: createElement(
                  CanvasExecutionProvider,
                  null,
                  createElement(Probe),
                ),
              },
            ),
          ),
        ),
      )
      await Promise.resolve()
    })

    const runtime = canvasExecutionRuntimeFor('p1')
    const controller = new AbortController()
    runtime.nodeScopedRunCancellation.trackPlan(
      'plan-old',
      ['node-old'],
    )
    runtime.engine.begin('plan-old', controller)

    act(() => root.unmount())
    expect(adapter).not.toBeNull()

    updateCanvasRunState('p1', 'node-old', {
      kind: 'failed',
      error: {
        code: 'http/500',
        message: '后台失败',
      },
    } as never)

    expect(adapter!.nodeStateOf('node-old')).toMatchObject({
      kind: 'failed',
    })
    expect(adapter!.nodeStates.get('node-old')).toMatchObject({
      kind: 'failed',
    })

    updateCanvasRunState('p1', 'node-old', {
      kind: 'running',
      startedAt: 1,
    })
    expect(adapter!.isRunning).toBe(true)
    adapter!.cancel('node-old')
    expect(controller.signal.aborted).toBe(true)

    store.dispose()
  })

  it('版本基线跨 provider 生命周期保留，不会重载后从 0 重号', async () => {
    await initializeCanvasExecutionVersions(
      'p1',
      async () => new Map([['node-1', 5]]),
    )

    expect(nextCanvasExecutionVersion('p1', 'node-1')).toBe(6)
    expect(nextCanvasExecutionVersion('p1', 'node-1')).toBe(7)

    await initializeCanvasExecutionVersions(
      'p1',
      async () => new Map([['node-1', 0]]),
    )
    expect(nextCanvasExecutionVersion('p1', 'node-1')).toBe(8)
  })
})
