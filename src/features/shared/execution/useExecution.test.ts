import { createElement, useEffect } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import {
  TaskLifecycleClosedError,
  TaskLifecycleTimeoutError,
} from '../lifecycle/taskLifecycle'
import { createExecutionRuntime } from './executionRuntime'
import {
  useExecution,
  type ExecutionHost,
  type UseExecution,
} from './useExecution'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const plan: RunPlan = {
  id: 'plan-slow',
  mode: 'single',
  scope: 'node',
  tasks: [{
    id: 'task-slow',
    nodeId: 'node-slow',
    request: {
      kind: 'image',
      channelId: 'channel',
      model: 'model',
      prompt: 'slow',
      inputs: [],
      params: {},
    },
    dependsOn: [],
    fingerprint: 'fp',
    params: {},
  }],
}

describe('useExecution lifecycle', () => {
  it('dispose 跟踪完整 startRun，超时拒绝并在关闭后拒绝新开始', async () => {
    const runtime = createExecutionRuntime()
    const started = deferred<void>()
    const channel = deferred<void>()
    const host: ExecutionHost<typeof plan.tasks[number], string> = {
      projectId: 'p1',
      writeBack: vi.fn(),
      channelResolver: () => ({
        generateImage: async () => {
          started.resolve()
          await channel.promise
          return []
        },
      }) as never,
      placement: {
        begin: (task) => ({ targetId: task.nodeId, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      recordScope: () => ({
        scopeVersion: 1,
        workbench: 'canvas',
        subjectId: 'node-slow',
        scopeId: 'scope',
        operationId: 'operation',
      }),
    }
    let execution!: UseExecution<typeof plan.tasks[number]>

    function Probe() {
      const value = useExecution(host, runtime)
      useEffect(() => {
        execution = value
      }, [value])
      return null
    }

    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(createElement(Probe))
    })

    let running!: Promise<unknown>
    await act(async () => {
      running = execution.startRun(plan)
      await started.promise
    })
    await expect(
      runtime.dispose(5),
    ).rejects.toBeInstanceOf(TaskLifecycleTimeoutError)
    expect(runtime.closing).toBe(true)

    channel.resolve()
    await act(async () => {
      await running
    })
    await runtime.dispose(100)
    await expect(
      execution.startRun(plan),
    ).rejects.toBeInstanceOf(TaskLifecycleClosedError)

    act(() => root.unmount())
  })
})
