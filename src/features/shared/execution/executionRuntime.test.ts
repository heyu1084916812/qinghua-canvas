import { describe, expect, it, vi } from 'vitest'
import { createExecutionRuntime } from './executionRuntime'

describe('createExecutionRuntime', () => {
  it('登记并发计划，并允许 provider 重建后继续取消原 controller', () => {
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

    runtime.dispose()
    expect(second.signal.aborted).toBe(true)
    expect(runtime.isRunning()).toBe(false)
  })
})
