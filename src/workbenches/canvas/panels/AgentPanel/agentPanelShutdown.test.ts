import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProjectRuntimeBusyError,
  registerProjectRuntime,
  resetProjectRuntimesForTests,
  withPreparedProjectRuntimes,
} from '../../../../app/ProjectRuntimeRegistry'
import {
  createTaskLifecycle,
  type TaskShutdownControl,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import { createAgentPanelShutdownControl } from './agentPanelShutdown'

afterEach(() => {
  resetProjectRuntimesForTests()
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function idleTick(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('AgentPanel shutdown barrier', () => {
  it('flush 未落地时超时不 purge 也不 reopen，flush 成功后恢复并重试', async () => {
    const lifecycle = createTaskLifecycle()
    const flushGate = deferred<void>()
    let flushCalls = 0
    const finalized = vi.fn()
    let shutdown!: TaskShutdownControl
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () => {
        shutdown = createAgentPanelShutdownControl({
          lifecycle,
          flush: () => {
            flushCalls += 1
            return flushCalls === 1
              ? flushGate.promise
              : Promise.resolve()
          },
          timeoutMs: 5,
          onFinalize: finalized,
        })
        return shutdown
      },
    })
    const purge = vi.fn(async () => undefined)

    await expect(
      withPreparedProjectRuntimes(['p1'], purge),
    ).rejects.toMatchObject({ name: 'TaskLifecycleTimeoutError' })
    expect(purge).not.toHaveBeenCalled()
    expect(lifecycle.state).toBe('draining')
    expect(shutdown.canReopen()).toBe(false)
    expect(shutdown.canFinalize()).toBe(false)
    await expect(
      withPreparedProjectRuntimes(['p1'], purge),
    ).rejects.toBeInstanceOf(ProjectRuntimeBusyError)

    flushGate.resolve()
    await idleTick()
    expect(lifecycle.state).toBe('open')
    await withPreparedProjectRuntimes(['p1'], purge)

    expect(purge).toHaveBeenCalledOnce()
    expect(finalized).toHaveBeenCalledOnce()
    expect(lifecycle.state).toBe('closed')
  })

  it('flush 失败也只在 Promise 落地后恢复，之后仍可写入并重试删除', async () => {
    const lifecycle = createTaskLifecycle()
    const flushGate = deferred<void>()
    let flushCalls = 0
    registerProjectRuntime({
      projectId: 'p1',
      key: 'canvas-agent',
      beginDispose: () =>
        createAgentPanelShutdownControl({
          lifecycle,
          flush: () => {
            flushCalls += 1
            return flushCalls === 1
              ? flushGate.promise
              : Promise.resolve()
          },
          timeoutMs: 5,
        }),
    })
    const purge = vi.fn(async () => undefined)

    await expect(
      withPreparedProjectRuntimes(['p1'], purge),
    ).rejects.toMatchObject({ name: 'TaskLifecycleTimeoutError' })
    expect(purge).not.toHaveBeenCalled()
    expect(lifecycle.state).toBe('draining')

    flushGate.reject(new Error('flush failed'))
    await idleTick()
    expect(lifecycle.state).toBe('open')
    await expect(
      lifecycle.track(async () => 'written after failure'),
    ).resolves.toBe('written after failure')

    await withPreparedProjectRuntimes(['p1'], purge)
    expect(purge).toHaveBeenCalledOnce()
  })
})
