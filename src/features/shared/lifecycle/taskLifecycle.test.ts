import { describe, expect, it, vi } from 'vitest'
import {
  TaskLifecycleClosedError,
  TaskLifecycleTimeoutError,
  combineTaskShutdownControls,
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
    const attempt = lifecycle.beginClose()

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
    expect(lifecycle.reopenIfIdle(attempt)).toBe(true)
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

  it('有在途任务时拒绝假装重开，真正 idle 后才恢复', async () => {
    const lifecycle = createTaskLifecycle()
    const gate = deferred<void>()
    const work = lifecycle.track(() => gate.promise)
    const attempt = lifecycle.beginClose()

    expect(lifecycle.canReopen(attempt)).toBe(false)
    expect(lifecycle.reopenIfIdle(attempt)).toBe(false)
    const recovery = lifecycle.reopenWhenIdle(attempt)
    gate.resolve()
    await work
    await expect(recovery).resolves.toBe(true)
    expect(lifecycle.state).toBe('open')
    await expect(
      lifecycle.track(async () => 'resumed'),
    ).resolves.toBe('resumed')
  })

  it('重试关闭会失效旧 attempt，旧恢复不得重开新关闭', () => {
    const lifecycle = createTaskLifecycle()
    const first = lifecycle.beginClose()
    const second = lifecycle.beginClose()
    expect(lifecycle.reopenIfIdle(first)).toBe(false)
    expect(lifecycle.finalizeClose(first)).toBe(false)
    expect(lifecycle.reopenIfIdle(second)).toBe(true)
  })

  it('组合控制只有全部 participant 都 idle 才恢复或提交', async () => {
    const a = createTaskLifecycle()
    const b = createTaskLifecycle()
    const gate = deferred<void>()
    const work = b.track(() => gate.promise)
    const attemptA = a.beginClose()
    const attemptB = b.beginClose()
    const combined = combineTaskShutdownControls([
      {
        waitForIdle: () => a.waitForIdle(100),
        whenIdle: a.whenIdle,
        canReopen: () => a.canReopen(attemptA),
        reopenIfIdle: () => a.reopenIfIdle(attemptA),
        canFinalize: () => a.canFinalize(attemptA),
        finalize: () => a.finalizeClose(attemptA),
      },
      {
        waitForIdle: () => b.waitForIdle(100),
        whenIdle: b.whenIdle,
        canReopen: () => b.canReopen(attemptB),
        reopenIfIdle: () => b.reopenIfIdle(attemptB),
        canFinalize: () => b.canFinalize(attemptB),
        finalize: () => b.finalizeClose(attemptB),
      },
    ])

    expect(combined.canReopen()).toBe(false)
    expect(combined.reopenIfIdle()).toBe(false)
    gate.resolve()
    await work
    expect(combined.canReopen()).toBe(true)
    expect(combined.reopenIfIdle()).toBe(true)
    expect(a.state).toBe('open')
    expect(b.state).toBe('open')
  })

  it('组合控制只在全部 finalize 后释放提交期资源', () => {
    const releaseA = vi.fn()
    const releaseB = vi.fn()
    const combined = combineTaskShutdownControls([
      {
        waitForIdle: async () => undefined,
        whenIdle: async () => undefined,
        canReopen: () => true,
        reopenIfIdle: () => true,
        canFinalize: () => true,
        finalize: () => true,
        releaseFinalized: releaseA,
      },
      {
        waitForIdle: async () => undefined,
        whenIdle: async () => undefined,
        canReopen: () => true,
        reopenIfIdle: () => true,
        canFinalize: () => true,
        finalize: () => true,
        releaseFinalized: releaseB,
      },
    ])

    expect(releaseA).not.toHaveBeenCalled()
    combined.releaseFinalized?.()
    expect(releaseA).toHaveBeenCalledOnce()
    expect(releaseB).toHaveBeenCalledOnce()
  })
})
