import { describe, expect, it, vi } from 'vitest'
import {
  TaskLifecycleClosedError,
  TaskLifecycleTimeoutError,
  createTaskLifecycle,
} from './taskLifecycle'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('taskLifecycle', () => {
  it('先关闭新入口，再等待完整在途 Promise', async () => {
    const lifecycle = createTaskLifecycle()
    const gate = deferred<void>()
    const cleanup = vi.fn()
    const work = lifecycle.track(async () => {
      await gate.promise
      cleanup()
    })

    lifecycle.beginClose()
    expect(lifecycle.closing).toBe(true)
    await expect(
      lifecycle.track(async () => undefined),
    ).rejects.toBeInstanceOf(TaskLifecycleClosedError)

    const waited = lifecycle.waitForIdle(500)
    await Promise.resolve()
    expect(cleanup).not.toHaveBeenCalled()
    gate.resolve()
    await work
    await waited
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('超时可观察，失败后不把在途任务当成已完成', async () => {
    const lifecycle = createTaskLifecycle()
    const gate = deferred<void>()
    const work = lifecycle.track(() => gate.promise)
    lifecycle.beginClose()

    await expect(
      lifecycle.waitForIdle(5),
    ).rejects.toMatchObject({
      name: 'TaskLifecycleTimeoutError',
      pending: 1,
      timeoutMs: 5,
    })

    gate.resolve()
    await work
    await expect(lifecycle.waitForIdle(100)).resolves.toBeUndefined()
  })

  it('等待超时使用可辨识错误类型', async () => {
    const lifecycle = createTaskLifecycle()
    const gate = deferred<void>()
    const work = lifecycle.track(() => gate.promise)
    lifecycle.beginClose()
    await expect(
      lifecycle.waitForIdle(1),
    ).rejects.toBeInstanceOf(TaskLifecycleTimeoutError)
    gate.resolve()
    await work
  })
})
