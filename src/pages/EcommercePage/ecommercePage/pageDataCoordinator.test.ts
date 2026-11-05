import { describe, expect, it, vi } from 'vitest'
import {
  loadEcommerceInitialTask,
  projectEcommerceCanvasItemDiff,
  refreshEcommerceTask,
  refreshEcommerceWorkbench,
  type EcommercePageDataPorts,
} from './pageDataCoordinator'
import type { RunLogPage, RunLogQuery } from '../../../state/shared/runLogRepository'

const task = (id: string, status: string) => ({
  id,
  projectId: 'p',
  batchId: `b-${id}`,
  createdAt: 1,
  updatedAt: 1,
  status,
  request: { usage: 'set' },
  nodeIds: [],
}) as never

const row = (id: string, status: string, updatedAt = 1) => ({
  id,
  taskId: 't',
  projectId: 'p',
  nodeId: `n-${id}`,
  position: 0,
  createdAt: 1,
  updatedAt,
  status,
}) as never

function makePorts(overrides: Partial<EcommercePageDataPorts> = {}): EcommercePageDataPorts {
  const defaults: EcommercePageDataPorts = {
    projectId: 'p',
    canvasSaveQueue: Promise.resolve(),
    taskRepo: {
      reconcileFromRunRecords: vi.fn(async () => undefined),
      listResults: vi.fn(async () => [row('r1', 'done')]),
      latestWithResults: vi.fn(async () => null),
      list: vi.fn(async () => []),
      interruptUnfinished: vi.fn(async () => null),
      results: vi.fn(async () => []),
      updateTask: vi.fn(async () => undefined),
      removeResult: vi.fn(async () => null),
    },
    canvasRepo: { sync: vi.fn(async () => []) },
    runLogs: {
      query: vi.fn(async (_filter?: RunLogQuery): Promise<RunLogPage> => ({
        entries: [],
        total: 0,
      })),
    },
  }
  return {
    ...defaults,
    ...overrides,
    taskRepo: { ...defaults.taskRepo, ...(overrides.taskRepo ?? {}) },
    canvasRepo: overrides.canvasRepo ?? defaults.canvasRepo,
    runLogs: overrides.runLogs ?? defaults.runLogs,
  }
}

describe('ecommerce page data coordinator', () => {
  it('reconciles before parallel refresh reads and preserves save-queue ordering', async () => {
    const calls: string[] = []
    let releaseSave: () => void = () => {}
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
    const defaults = makePorts()
    const ports = makePorts({
      canvasSaveQueue: saveGate.then(() => { calls.push('save') }),
      taskRepo: {
        ...defaults.taskRepo,
        reconcileFromRunRecords: vi.fn(async () => { calls.push('reconcile') }),
        listResults: vi.fn(async () => { calls.push('results'); return [row('r1', 'done')] }),
      },
      canvasRepo: { sync: vi.fn(async () => { calls.push('sync'); return [] }) },
      runLogs: {
        query: vi.fn(async (_filter?: RunLogQuery): Promise<RunLogPage> => {
          calls.push('runs')
          return { entries: [], total: 0 }
        }),
      },
    })
    const pending = refreshEcommerceWorkbench(ports, 900)
    await Promise.resolve()
    expect(calls).toEqual([])
    releaseSave()
    const snapshot = await pending
    expect(calls[0]).toBe('save')
    expect(calls).toEqual(['save', 'reconcile', 'sync', 'results', 'runs'])
    expect(snapshot.results).toHaveLength(1)
  })

  it('reads first screen after reconciliation and interrupts only running tasks without a live lease', async () => {
    const running = task('t1', 'running')
    const done = task('t2', 'done')
    const recovered = { ...(running as object), status: 'failed', errorText: '中断', updatedAt: 4 } as never
    const defaults = makePorts()
    const ports = makePorts({
      taskRepo: {
        ...defaults.taskRepo,
        latestWithResults: vi.fn(async () => ({ task: running, results: [row('r1', 'running')] })),
        list: vi.fn(async () => [running, done, task('t3', 'running')]),
        interruptUnfinished: vi.fn(async (taskId: string) => taskId === 't1'
          ? { task: recovered, results: [row('r1', 'failed')] }
          : null),
      },
    })
    const loaded = await loadEcommerceInitialTask(ports)
    expect(loaded.activeTask?.id).toBe('t1')
    expect(loaded.activeTask?.status).toBe('failed')
    expect(loaded.taskHistory.map((item) => item.status)).toEqual(['failed', 'done', 'running'])
    expect(ports.taskRepo.interruptUnfinished).toHaveBeenCalledTimes(2)
  })

  it('recomputes task status from terminal rows and replaces or clears stale error text', async () => {
    const ports = makePorts()
    ports.taskRepo.results = vi.fn(async () => [row('r1', 'failed'), row('r2', 'canceled')])
    const failed = await refreshEcommerceTask(ports, task('t', 'running'), 9)
    expect(failed.task.status).toBe('failed')
    expect(failed.task.updatedAt).toBe(9)
    expect(failed.task).not.toHaveProperty('errorText')
    expect(ports.taskRepo.reconcileFromRunRecords).toHaveBeenCalledBefore(ports.taskRepo.results as never)

    const withError = await refreshEcommerceTask({
      ...ports,
      taskRepo: {
        ...ports.taskRepo,
        results: vi.fn(async () => [Object.assign({}, row('r1', 'failed') as object, { errorText: '上游失败' })] as never[]),
      },
    }, Object.assign({}, task('t', 'running') as object, { errorText: '旧错误' }) as never, 10)
    expect(withError.task.errorText).toBe('上游失败')
  })

  it('projects hidden and restored result ids from canvas item identity', () => {
    const before = [
      { id: 'a', resultId: 'r1' },
      { id: 'b', resultId: 'r2' },
    ] as never[]
    const next = [
      { id: 'a', resultId: 'r1' },
      { id: 'c', resultId: 'r3' },
    ] as never[]
    expect(projectEcommerceCanvasItemDiff(before, next)).toEqual({
      next,
      hiddenResultIds: ['r2'],
      restoredResultIds: ['r3'],
    })
  })
})
