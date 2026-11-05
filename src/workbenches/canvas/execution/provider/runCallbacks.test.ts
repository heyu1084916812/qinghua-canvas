import { describe, expect, it, vi } from 'vitest'
import { createExecutionRuntime } from '../../../../features/shared/execution/executionRuntime'
import { createTaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import { createNodeScopedRunCancellation } from '../../../../features/canvas/execution/nodeScopedRunCancellation'
import {
  imageCountOf,
  progressNotice,
  runNotice,
  shouldNotify,
  type NotifyPrefs,
} from '../../../../domain/ui/notify'
import { createCanvasRunCallbacks } from './runCallbacks'

const prefs: NotifyPrefs = { success: true, failure: true, progress: true }

function setup() {
  const states = new Map<string, unknown>()
  const store = {
    dispatch: vi.fn((command: { kind: string }) => ({ command })),
    flush: vi.fn(async () => undefined),
    getSnapshot: vi.fn(() => ({
      projectId: 'p1',
      nodes: [{ id: 'node-1', data: { scope: 'canvas' } }],
    })),
    notify: vi.fn(),
  }
  const runtime = {
    projectId: 'p1',
    closed: false,
    engine: createExecutionRuntime(),
    operations: createTaskLifecycle(),
    adapterMaps: new Map<string, Map<string, never>>(),
    taskToNodeMaps: new Map<string, Map<string, string>>(),
    nodeScopedRunCancellation: createNodeScopedRunCancellation(),
    channelInterruptedPlans: new Set<string>(),
    preparingPrompt: new Set<string>(),
    planProgress: new Map<string, { done: number; total: number }>(),
    versionMax: new Map<string, number>(),
  }
  const sendSystemNotify = vi.fn(async () => true)
  const callbacks = createCanvasRunCallbacks({
    runtime: runtime as never,
    store,
    workbench: 'canvas',
    platformNotify: undefined,
    resolveCanvasRecordScope: vi.fn(() => ({
      scopeVersion: 1 as const,
      workbench: 'canvas' as const,
      subjectId: 'node-1',
      scopeId: 'plan:plan-1',
      operationId: 'plan-1',
    })),
    createPlacement: vi.fn(() => ({ placement: true }) as never),
    adapterKey: (channelId, groupId, kind) => `${channelId}:${groupId ?? ''}:${kind}`,
    updateRunStates: (_projectId, update) => {
      const next = update(states as never)
      states.clear()
      for (const [key, value] of next) states.set(key, value)
    },
    getNotifyPrefs: () => prefs,
    progressNotice,
    runNotice,
    shouldNotify,
    imageCountOf,
    sendSystemNotify,
  })
  return { callbacks, runtime, states, store, sendSystemNotify }
}

describe('canvas run callbacks', () => {
  it('按 planId 精确更新节点状态，不把进度串到另一计划', () => {
    const { callbacks, runtime, store } = setup()
    runtime.taskToNodeMaps.set('plan-1', new Map([['task-1', 'node-1']]))
    runtime.taskToNodeMaps.set('plan-2', new Map([['task-2', 'node-2']]))
    runtime.planProgress.set('plan-1', { done: 0, total: 2 })
    runtime.planProgress.set('plan-2', { done: 0, total: 2 })

    callbacks.onTaskUpdate('plan-1', 'task-1', { kind: 'running', startedAt: 1 })
    callbacks.onTaskUpdate('plan-1', 'task-1', { kind: 'succeeded', result: [], duration: 1 })
    callbacks.onTaskUpdate('plan-2', 'task-2', { kind: 'running', startedAt: 2 })

    expect(store.dispatch).not.toHaveBeenCalled()
    expect(store.notify).toHaveBeenCalledTimes(1)
    expect(store.notify).toHaveBeenCalledWith('批量进度：1/2')
    expect(runtime.planProgress.get('plan-1')?.done).toBe(1)
    expect(runtime.planProgress.get('plan-2')?.done).toBe(0)
  })

  it('落点改绑把 queued 从源节点搬到承载节点并登记取消目标', () => {
    const { callbacks, runtime, states } = setup()
    const mapping = new Map([['task-1', 'source']])
    runtime.taskToNodeMaps.set('plan-1', mapping)
    const addTarget = vi.spyOn(runtime.nodeScopedRunCancellation, 'addTarget')
    states.set('source', { kind: 'running', startedAt: 1 })

    callbacks.onTaskTarget('plan-1', 'task-1', 'carrier')

    expect(mapping.get('task-1')).toBe('carrier')
    expect(addTarget).toHaveBeenCalledWith('plan-1', 'carrier')
    expect(states.get('source')).toBeUndefined()
    expect(states.get('carrier')).toMatchObject({ kind: 'running' })
  })

  it('收口先 flush 再清进度，渠道中断只报既有错误提示', () => {
    const { callbacks, runtime, store, sendSystemNotify } = setup()
    runtime.planProgress.set('plan-1', { done: 2, total: 2 })
    runtime.channelInterruptedPlans.add('plan-1')
    const events: string[] = []
    store.flush.mockImplementation(async () => {
      events.push('flush')
    })
    store.notify.mockImplementation(() => events.push('notify'))

    callbacks.onFinish({
      runPlanId: 'plan-1',
      mode: 'single',
      taskResults: [],
      succeeded: 0,
      failed: 1,
      canceled: 0,
      startedAt: 0,
      finishedAt: 1,
      records: [],
    } as never)

    expect(events).toEqual(['flush', 'notify'])
    expect(store.notify).toHaveBeenCalledWith(
      '渠道已删除，相关生成已停止；请重新选择平台后再生成',
      'error',
    )
    expect(sendSystemNotify).not.toHaveBeenCalled()
    expect(runtime.planProgress.has('plan-1')).toBe(false)
  })

  it('正常收口只发一次页内与系统通知', () => {
    const { callbacks, store, sendSystemNotify } = setup()
    callbacks.onFinish({
      runPlanId: 'plan-1',
      mode: 'single',
      taskResults: [{
        taskId: 'task-1',
        nodeId: 'node-1',
        state: { kind: 'succeeded', result: [{ hash: 'a' }], duration: 1 },
      }],
      succeeded: 1,
      failed: 0,
      canceled: 0,
      startedAt: 0,
      finishedAt: 1,
      records: [],
    } as never)

    expect(store.notify).toHaveBeenCalledTimes(1)
    expect(store.notify).toHaveBeenCalledWith('生成完成：1 张', 'info')
    expect(sendSystemNotify).toHaveBeenCalledTimes(1)
    expect(sendSystemNotify).toHaveBeenCalledWith(undefined, '轻画', '生成完成：1 张')
  })
})
