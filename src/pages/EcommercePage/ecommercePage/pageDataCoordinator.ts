import { hasEcommerceTaskLease } from '../../../features/ecommerce/execution/taskLease'
import { taskStatusOf, type EcommerceResultRecord, type EcommerceTaskRecord } from '../../../domain/ecommerce/tasks'
import type { EcommerceCanvasItem } from '../../../domain/ecommerce/canvasItem'
import type { RunLogRepository } from '../../../state/shared/runLogRepository'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'

export interface EcommerceWorkbenchSnapshot {
  items: EcommerceCanvasItem[]
  results: EcommerceResultRecord[]
  runs: RunRecord[]
}

export interface EcommercePageDataPorts {
  projectId: string
  canvasSaveQueue: Promise<void>
  taskRepo: {
    reconcileFromRunRecords(projectId: string): Promise<unknown>
    listResults(projectId: string): Promise<EcommerceResultRecord[]>
    latestWithResults(projectId: string): Promise<{
      task: EcommerceTaskRecord
      results: EcommerceResultRecord[]
    } | null>
    list(projectId: string): Promise<EcommerceTaskRecord[]>
    interruptUnfinished(taskId: string, reason: string): Promise<{
      task: EcommerceTaskRecord
      results: EcommerceResultRecord[]
    } | null>
    results(taskId: string): Promise<EcommerceResultRecord[]>
    updateTask(task: EcommerceTaskRecord): Promise<unknown>
    removeResult(resultId: string): Promise<{
      task: EcommerceTaskRecord
      results: EcommerceResultRecord[]
    } | null>
  }
  canvasRepo: {
    sync(projectId: string, viewportWidth: number): Promise<EcommerceCanvasItem[]>
  }
  runLogs: Pick<RunLogRepository, 'query'>
}

/** Refresh waits for layout saves, reconciles RunRecords first, then reads all projections. */
export async function refreshEcommerceWorkbench(
  ports: EcommercePageDataPorts,
  viewportWidth: number,
): Promise<EcommerceWorkbenchSnapshot> {
  await ports.canvasSaveQueue
  await ports.taskRepo.reconcileFromRunRecords(ports.projectId)
  const [items, rows, runs] = await Promise.all([
    ports.canvasRepo.sync(ports.projectId, viewportWidth),
    ports.taskRepo.listResults(ports.projectId),
    ports.runLogs.query({
      projectId: ports.projectId,
      workbench: 'ecommerce',
      limit: Number.MAX_SAFE_INTEGER,
    }),
  ])
  return {
    items,
    results: rows,
    runs: runs.entries.map((entry) => entry.record as RunRecord),
  }
}

export interface EcommerceInitialTaskLoad {
  activeTask: EcommerceTaskRecord | null
  resultRows: EcommerceResultRecord[]
  taskHistory: EcommerceTaskRecord[]
}

/** First read reconciles terminal RunRecords, then interrupts persisted running tasks without a live lease. */
export async function loadEcommerceInitialTask(
  ports: EcommercePageDataPorts,
): Promise<EcommerceInitialTaskLoad> {
  await ports.taskRepo.reconcileFromRunRecords(ports.projectId)
  const [latestRow, initialList] = await Promise.all([
    ports.taskRepo.latestWithResults(ports.projectId),
    ports.taskRepo.list(ports.projectId),
  ])
  let latest = latestRow
  let list = initialList
  for (const runningTask of initialList.filter((task) => task.status === 'running')) {
    if (hasEcommerceTaskLease(runningTask.id)) continue
    const recovered = await ports.taskRepo.interruptUnfinished(
      runningTask.id,
      '上次生成被中断，请重新生成。',
    )
    if (recovered) {
      list = list.map((task) => (task.id === recovered.task.id ? recovered.task : task))
      if (latest?.task.id === recovered.task.id) latest = recovered
    }
  }
  return {
    activeTask: latest?.task ?? null,
    resultRows: latest?.results ?? [],
    taskHistory: list,
  }
}

/** Recompute a task from its reconciled rows, preserving the existing error field only when no row has a fresher error. */
export async function refreshEcommerceTask(
  ports: EcommercePageDataPorts,
  task: EcommerceTaskRecord,
  now = Date.now(),
): Promise<{ task: EcommerceTaskRecord; rows: EcommerceResultRecord[] }> {
  await ports.taskRepo.reconcileFromRunRecords(ports.projectId)
  const rows = await ports.taskRepo.results(task.id)
  const status = taskStatusOf(rows)
  const failed = rows.find((row) => row.status === 'failed' && row.errorText)
  const { errorText: _oldError, ...rest } = task
  const next: EcommerceTaskRecord = {
    ...rest,
    updatedAt: now,
    status,
    ...(failed?.errorText ? { errorText: failed.errorText } : {}),
  }
  await ports.taskRepo.updateTask(next)
  return { task: next, rows }
}

export interface EcommerceCanvasItemDiff {
  next: EcommerceCanvasItem[]
  hiddenResultIds: string[]
  restoredResultIds: string[]
}

export function projectEcommerceCanvasItemDiff(
  before: readonly EcommerceCanvasItem[],
  next: readonly EcommerceCanvasItem[],
): EcommerceCanvasItemDiff {
  const nextIds = new Set(next.map((item) => item.id))
  const beforeIds = new Set(before.map((item) => item.id))
  return {
    next: [...next],
    hiddenResultIds: before
      .filter((item) => item.resultId && !nextIds.has(item.id))
      .map((item) => item.resultId as string),
    restoredResultIds: next
      .filter((item) => item.resultId && !beforeIds.has(item.id))
      .map((item) => item.resultId as string),
  }
}
