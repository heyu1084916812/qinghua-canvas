import { taskStatusOf, type EcommerceResultRecord, type EcommerceTaskRecord } from '../../../domain/ecommerce/tasks'
import type { QueuedAssetSave } from './types'
import { firstOutputHashOf } from './rowMappers'

export function resultsByPosition(rows: readonly EcommerceResultRecord[]): EcommerceResultRecord[] {
  return rows.slice().sort((a, b) => a.position - b.position)
}

export function projectResults(rows: readonly EcommerceResultRecord[]): EcommerceResultRecord[] {
  return rows.slice().sort((a, b) => a.createdAt - b.createdAt || a.position - b.position)
}

export function latestTasks(rows: readonly EcommerceTaskRecord[]): EcommerceTaskRecord[] {
  return rows
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)
}

export function listedTasks(rows: readonly EcommerceTaskRecord[]): EcommerceTaskRecord[] {
  return rows.slice().sort((a, b) => b.createdAt - a.createdAt)
}

export function refreshedTask(
  task: EcommerceTaskRecord,
  results: readonly EcommerceResultRecord[],
  at: number,
): EcommerceTaskRecord {
  const failed = results.find((row) => row.status === 'failed' && row.errorText)
  const { errorText: _oldError, ...rest } = task
  return {
    ...rest,
    updatedAt: at,
    status: taskStatusOf(results),
    ...(failed?.errorText ? { errorText: failed.errorText } : {}),
  }
}

export function hiddenResult(
  result: EcommerceResultRecord,
  hidden: boolean,
  at: number,
): EcommerceResultRecord {
  const { hiddenAt: _hiddenAt, ...rest } = result
  return hidden ? { ...rest, hiddenAt: at } : rest
}

export function latestRunByNode(
  runs: readonly Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  for (const run of runs
    .slice()
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))) {
    const nodeId = String(run.nodeId ?? '')
    if (nodeId && !out.has(nodeId)) out.set(nodeId, run)
  }
  return out
}

export function queuedSaveByResult(
  queue: readonly QueuedAssetSave[],
): Map<string, QueuedAssetSave> {
  return new Map(queue.map((row) => [row.resultId, row] as const))
}

export function interruptResults(
  results: readonly EcommerceResultRecord[],
  runs: ReadonlyMap<string, Record<string, unknown>>,
  reason: string,
  at: number,
): EcommerceResultRecord[] {
  return results.map((row) => {
    if (row.status !== 'pending' && row.status !== 'running') return row
    const run = runs.get(row.nodeId)
    const runError =
      String(run?.status ?? '') === 'failed' &&
      typeof run?.errorText === 'string' &&
      run.errorText
        ? run.errorText
        : reason
    return { ...row, status: 'failed' as const, errorText: runError, updatedAt: at }
  })
}

export function interruptedTask(
  task: EcommerceTaskRecord,
  results: readonly EcommerceResultRecord[],
  reason: string,
  at: number,
): EcommerceTaskRecord {
  return {
    ...task,
    status: taskStatusOf(results),
    errorText:
      results.find((row) => row.status === 'failed' && row.errorText)?.errorText ?? reason,
    updatedAt: at,
  }
}

export function resultRemovable(
  before: EcommerceResultRecord,
  runRows: readonly Record<string, unknown>[],
): boolean {
  const latestRunStatus = String(
    runRows.slice().sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0]
      ?.status ?? '',
  )
  return (
    before.status === 'failed' ||
    before.status === 'canceled' ||
    latestRunStatus === 'failed' ||
    latestRunStatus === 'canceled'
  )
}

export function reconciledResult(
  row: EcommerceResultRecord,
  input: {
    run?: Record<string, unknown>
    hashIsReadable: (hash: string) => boolean
    queued?: QueuedAssetSave
    at: number
  },
): EcommerceResultRecord {
  const run = input.run
  const runStatus = String(run?.status ?? '')
  const runOutputHash = firstOutputHashOf(run)
  const active = row.status === 'pending' || row.status === 'running'
  const needsHashBackfill = row.status === 'done' && !row.assetHash
  const needsRetrySave = row.recovery === 'retry-save'
  const needsIntegrityCheck = row.status === 'done' && Boolean(row.assetHash)
  if (!active && !needsHashBackfill && !needsRetrySave && !needsIntegrityCheck) return row
  if (
    run &&
    runStatus !== 'succeeded' &&
    runStatus !== 'failed' &&
    runStatus !== 'canceled'
  ) {
    return row
  }
  if (!run && active) return row
  const succeeded = run ? runStatus === 'succeeded' : row.status === 'done'
  const outputHash = succeeded ? runOutputHash ?? row.assetHash : undefined
  const outputAssetExists = Boolean(outputHash && input.hashIsReadable(outputHash))
  if (
    succeeded &&
    outputHash &&
    outputAssetExists &&
    row.status === 'done' &&
    row.assetHash === outputHash &&
    !row.recovery
  ) {
    return row
  }
  const assetHash = succeeded
    ? outputAssetExists
      ? outputHash
      : undefined
    : row.assetHash
  const queued = input.queued
  const rest = withoutReconciledFields(row)
  return {
    ...rest,
    updatedAt: input.at,
    status: succeeded ? (assetHash ? 'done' : 'failed') : 'failed',
    ...(assetHash ? { assetHash } : {}),
    ...(assetHash && (row.mime || queued?.assets[0]?.mime)
      ? { mime: row.mime ?? queued?.assets[0]?.mime }
      : {}),
    ...(assetHash && succeeded && typeof run?.sentModel === 'string'
      ? { model: run.sentModel }
      : {}),
    ...(assetHash && typeof run?.outputWidth === 'number' && run.outputWidth > 0
      ? { width: run.outputWidth }
      : {}),
    ...(assetHash && typeof run?.outputHeight === 'number' && run.outputHeight > 0
      ? { height: run.outputHeight }
      : {}),
    ...(succeeded && outputHash && !outputAssetExists && queued
      ? {
          recovery: 'retry-save' as const,
          errorText:
            queued.errorText ??
            '生成已成功，但素材字节不在库中。请重试保存同一产物，不要重新生成。',
        }
      : !succeeded || !assetHash
        ? {
            errorText:
              !succeeded && typeof run?.errorText === 'string' && run.errorText
                ? run.errorText
                : !succeeded
                  ? '这次 API 调用失败，但上游没有返回可读原因'
                  : '生成已完成，但没有找到可展示的产物',
          }
        : {}),
  }
}

function withoutReconciledFields(
  row: EcommerceResultRecord,
): Omit<EcommerceResultRecord, 'errorText' | 'recovery' | 'assetHash' | 'mime' | 'width' | 'height'> {
  const {
    errorText: _oldError,
    recovery: _oldRecovery,
    assetHash: _oldAssetHash,
    mime: _oldMime,
    width: _oldWidth,
    height: _oldHeight,
    ...rest
  } = row
  return rest
}

export function hashesToVerify(
  results: readonly EcommerceResultRecord[],
  runs: ReadonlyMap<string, Record<string, unknown>>,
): Set<string> {
  const out = new Set<string>()
  for (const row of results) {
    const run = runs.get(row.nodeId)
    const runHash =
      String(run?.status ?? '') === 'succeeded' ? firstOutputHashOf(run) : undefined
    const hash = runHash ?? row.assetHash
    if (
      hash &&
      (Boolean(runHash) || row.status === 'done' || row.recovery === 'retry-save')
    ) {
      out.add(hash)
    }
  }
  return out
}

export function reconciledTasks(
  tasks: readonly EcommerceTaskRecord[],
  nextResults: readonly EcommerceResultRecord[],
  changedResults: readonly EcommerceResultRecord[],
  at: number,
): { next: EcommerceTaskRecord[]; changed: EcommerceTaskRecord[] } {
  const affected = new Set(changedResults.map((row) => row.taskId))
  for (const task of tasks) {
    const rows = nextResults.filter((row) => row.taskId === task.id)
    const realError = rows.find((row) => row.status === 'failed' && row.errorText)?.errorText
    if (task.status !== taskStatusOf(rows) || realError !== task.errorText) {
      affected.add(task.id)
    }
  }
  const next = tasks.map((task) => {
    if (!affected.has(task.id)) return task
    return refreshedTask(task, nextResults.filter((row) => row.taskId === task.id), at)
  })
  const changed = next.filter((task) => {
    const old = tasks.find((candidate) => candidate.id === task.id)
    return old?.status !== task.status || old?.errorText !== task.errorText
  })
  return { next, changed }
}
