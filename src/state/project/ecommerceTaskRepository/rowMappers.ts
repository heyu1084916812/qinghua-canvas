import type { GeneratedAsset } from '../../../platform/channels/types'
import {
  resultMetadataOf,
  statusOfResult,
  statusOfTask,
  type EcommerceResultRecord,
  type EcommerceTaskRecord,
} from '../../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { QueuedAssetSave } from './types'

/** 存储行到业务记录唯一映射：脏数字归零、非法状态回落、可选字段不落空占位。 */
export function taskOf(row: Record<string, unknown>): EcommerceTaskRecord {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    batchId: String(row.batchId),
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    status: statusOfTask(row.status),
    request: (row.request ?? {}) as EcommerceRequest,
    nodeIds: Array.isArray(row.nodeIds) ? row.nodeIds.map(String) : [],
    ...(typeof row.sourceTaskId === 'string' && row.sourceTaskId
      ? { sourceTaskId: row.sourceTaskId }
      : {}),
    ...(typeof row.sourceResultId === 'string' && row.sourceResultId
      ? { sourceResultId: row.sourceResultId }
      : {}),
    ...(typeof row.sourceAssetHash === 'string' && row.sourceAssetHash
      ? { sourceAssetHash: row.sourceAssetHash }
      : {}),
    ...(typeof row.errorText === 'string' && row.errorText ? { errorText: row.errorText } : {}),
  }
}

export function resultOf(row: Record<string, unknown>): EcommerceResultRecord {
  const numberOrUndefined = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const stringOrUndefined = (value: unknown) =>
    typeof value === 'string' && value.length > 0 ? value : undefined
  return {
    id: String(row.id),
    taskId: String(row.taskId),
    projectId: String(row.projectId),
    nodeId: String(row.nodeId),
    ...(stringOrUndefined(row.canvasCopyNodeId)
      ? { canvasCopyNodeId: String(row.canvasCopyNodeId) }
      : {}),
    position: Number(row.position) || 0,
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    status: statusOfResult(row.status),
    ...(stringOrUndefined(row.assetHash) ? { assetHash: String(row.assetHash) } : {}),
    ...(stringOrUndefined(row.mime) ? { mime: String(row.mime) } : {}),
    ...(numberOrUndefined(row.hiddenAt) !== undefined
      ? { hiddenAt: Number(row.hiddenAt) }
      : {}),
    ...(numberOrUndefined(row.width) !== undefined ? { width: Number(row.width) } : {}),
    ...(numberOrUndefined(row.height) !== undefined ? { height: Number(row.height) } : {}),
    ...(stringOrUndefined(row.prompt) ? { prompt: String(row.prompt) } : {}),
    ...(stringOrUndefined(row.model) ? { model: String(row.model) } : {}),
    ...(stringOrUndefined(row.errorText) ? { errorText: String(row.errorText) } : {}),
    ...(row.recovery === 'retry-save' ? { recovery: 'retry-save' as const } : {}),
    ...resultMetadataOf({
      shotTitle: stringOrUndefined(row.shotTitle),
      brief: stringOrUndefined(row.brief),
      ratio: stringOrUndefined(row.ratio),
      headline: stringOrUndefined(row.headline),
      subheadline: stringOrUndefined(row.subheadline),
      visualSystem: stringOrUndefined(row.visualSystem),
    }),
  }
}

export function queuedSaveOf(row: Record<string, unknown>): QueuedAssetSave {
  const assets = Array.isArray(row.assets)
    ? (row.assets as GeneratedAsset[])
    : []
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    resultId: String(row.resultId ?? ''),
    taskId: String(row.taskId ?? ''),
    planId: String(row.planId ?? ''),
    prompt: String(row.prompt ?? ''),
    model: String(row.model ?? ''),
    assets,
    createdAt: Number(row.createdAt) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    ...(typeof row.errorText === 'string' && row.errorText
      ? { errorText: row.errorText }
      : {}),
  }
}

/** RunRecord 的成功产物可能不止一张；电商一格只认第一张。 */
export function firstOutputHashOf(run: Record<string, unknown> | undefined): string | undefined {
  if (!Array.isArray(run?.outputHashes)) return undefined
  return run.outputHashes.map(String).find((hash) => hash.length > 0)
}

export function resultRows(rows: readonly Record<string, unknown>[]): EcommerceResultRecord[] {
  return rows.map(resultOf)
}

export function taskRows(rows: readonly Record<string, unknown>[]): EcommerceTaskRecord[] {
  return rows.map(taskOf)
}

export function queuedSaveRows(rows: readonly Record<string, unknown>[]): QueuedAssetSave[] {
  return rows.map(queuedSaveOf)
}
