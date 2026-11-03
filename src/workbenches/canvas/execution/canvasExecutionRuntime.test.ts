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
  TaskLifecycleClosedError,
} from '../../../features/shared/lifecycle/taskLifecycle'
import {
  CanvasExecutionRuntimeClosedError,
  activateCanvasExecutionRuntime,
  beginCanvasExecutionRuntimeShutdown,
  canvasExecutionRuntimeFor,
  canvasExecutionRuntimeProjectIds,
  disposeAllCanvasExecutionRuntimes,
  disposeCanvasExecutionRuntime,
  initializeCanvasExecutionVersions,
  nextCanvasExecutionVersion,
  resetCanvasExecutionRuntimesForTests,
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
  resetCanvasExecutionRuntimesForTests()
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

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

    await disposeCanvasExecutionRuntime('p1', 100)
    await expect(
      adapter!.runNode('node-old'),
    ).rejects.toBeInstanceOf(TaskLifecycleClosedError)
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

  it('关闭等待完整任务；超时保留登记，成功 finalize 后墓碑拒绝生成入口', async () => {
    const runtime = canvasExecutionRuntimeFor('p1')
    const controller = new AbortController()
    const gate = deferred<void>()
    const records: string[] = []
    runtime.engine.begin('plan-a', controller)
    const run = runtime.engine.track(async () => {
      await gate.promise
      records.push('record-before-purge')
      runtime.engine.finish('plan-a')
    })

    const shutdown = beginCanvasExecutionRuntimeShutdown('p1')
    expect(shutdown).not.toBeNull()
    expect(controller.signal.aborted).toBe(true)
    expect(runtime.closed).toBe(true)
    expect(() => nextCanvasExecutionVersion('p1', 'node-1')).toThrow(
      CanvasExecutionRuntimeClosedError,
    )
    await expect(
      shutdown!.waitForIdle(5),
    ).rejects.toMatchObject({
      name: 'TaskLifecycleTimeoutError',
    })
    expect(canvasExecutionRuntimeProjectIds()).toContain('p1')
    expect(records).toEqual([])

    gate.resolve()
    await run
    await shutdown!.waitForIdle(100)
    shutdown!.finalize()
    expect(records).toEqual(['record-before-purge'])
    expect(canvasExecutionRuntimeProjectIds()).not.toContain('p1')
    expect(() => canvasExecutionRuntimeFor('p1')).toThrow(
      CanvasExecutionRuntimeClosedError,
    )
  })

  it('显式页面激活建立新代际，旧 runtime 闭包仍保持关闭', async () => {
    const oldRuntime = canvasExecutionRuntimeFor('p1')
    await disposeAllCanvasExecutionRuntimes()
    const nextRuntime = activateCanvasExecutionRuntime('p1')

    expect(nextRuntime).not.toBe(oldRuntime)
    expect(oldRuntime.closed).toBe(true)
    expect(nextRuntime.closed).toBe(false)
  })

  it('删除失败时可重开 idle runtime；有在途操作时不得假装重开', async () => {
    const runtime = canvasExecutionRuntimeFor('p1')
    const gate = deferred<void>()
    runtime.engine.begin('plan-open', new AbortController())
    const work = runtime.engine.track(async () => {
      await gate.promise
      runtime.engine.finish('plan-open')
    })
    const shutdown = beginCanvasExecutionRuntimeShutdown('p1')

    expect(shutdown.canReopen()).toBe(false)
    expect(shutdown.reopenIfIdle()).toBe(false)
    gate.resolve()
    await work
    expect(shutdown.canReopen()).toBe(true)
    expect(shutdown.reopenIfIdle()).toBe(true)
    expect(runtime.closed).toBe(false)
    await expect(
      runtime.operations.track(async () => 'send-again'),
    ).resolves.toBe('send-again')
  })
})
