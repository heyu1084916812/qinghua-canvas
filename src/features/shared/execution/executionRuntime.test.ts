import { describe, expect, it, vi } from 'vitest'
import {
  TaskLifecycleClosedError,
  TaskLifecycleTimeoutError,
} from '../lifecycle/taskLifecycle'
import { createExecutionRuntime } from './executionRuntime'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('createExecutionRuntime', () => {
  it('登记并发计划，并允许 provider 重建后继续取消原 controller', async () => {
    const runtime = createExecutionRuntime()
    const first = new AbortController()
    const second = new AbortController()
    const listener = vi.fn()
    runtime.subscribe(listener)

    runtime.begin('plan-a', first)
    runtime.begin('plan-b', second)

    expect(runtime.getRunningPlanIds()).toEqual([
      'plan-a',
      'plan-b',
    ])
    expect(runtime.isRunning()).toBe(true)

    runtime.cancel('plan-a')
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)

    runtime.finish('plan-a')
    expect(runtime.getRunningPlanIds()).toEqual(['plan-b'])
    expect(listener).toHaveBeenCalledTimes(3)

    await runtime.dispose()
    expect(second.signal.aborted).toBe(true)
    expect(runtime.isRunning()).toBe(false)
  })

  it('关闭后拒绝新工作，并等待完整 Promise 后才清理', async () => {
    const runtime = createExecutionRuntime()
    const gate = deferred<void>()
    const settled = vi.fn()
    const controller = new AbortController()
    runtime.begin('plan-a', controller)
    const work = runtime.track(async () => {
      await gate.promise
      settled()
      runtime.finish('plan-a')
    })

    const disposing = runtime.dispose(1_000)
    expect(controller.signal.aborted).toBe(true)
    expect(() =>
      runtime.begin('plan-b', new AbortController()),
    ).toThrow(TaskLifecycleClosedError)
    await expect(
      runtime.track(async () => undefined),
    ).rejects.toBeInstanceOf(TaskLifecycleClosedError)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    gate.resolve()
    await work
    await disposing
    expect(settled).toHaveBeenCalledOnce()
    expect(runtime.getRunningPlanIds()).toEqual([])
  })

  it('超时保留运行登记，释放延迟任务后可重试成功', async () => {
    const runtime = createExecutionRuntime()
    const gate = deferred<void>()
    const controller = new AbortController()
    runtime.begin('plan-a', controller)
    const work = runtime.track(async () => {
      await gate.promise
      runtime.finish('plan-a')
    })

    await expect(
      runtime.dispose(5),
    ).rejects.toBeInstanceOf(TaskLifecycleTimeoutError)
    expect(controller.signal.aborted).toBe(true)
    expect(runtime.closing).toBe(true)
    expect(runtime.getRunningPlanIds()).toEqual(['plan-a'])

    gate.resolve()
    await work
    await runtime.dispose(100)
    expect(runtime.getRunningPlanIds()).toEqual([])
  })
})
