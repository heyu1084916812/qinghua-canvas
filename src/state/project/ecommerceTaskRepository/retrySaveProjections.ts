import type { GeneratedAsset } from '../../../platform/channels/types'
import type { EcommerceResultRecord } from '../../../domain/ecommerce/tasks'
import type { QueuedAssetSave } from './types'

type PrimaryAsset = Pick<GeneratedAsset, 'hash' | 'mime' | 'width' | 'height'>

export function withoutResultAttempt(
  result: EcommerceResultRecord,
): Omit<EcommerceResultRecord, 'errorText' | 'recovery' | 'assetHash' | 'mime' | 'width' | 'height'> {
  const {
    errorText: _oldError,
    recovery: _oldRecovery,
    assetHash: _oldAssetHash,
    mime: _oldMime,
    width: _oldWidth,
    height: _oldHeight,
    ...rest
  } = result
  return rest
}

export function withoutResultFailure(
  result: EcommerceResultRecord,
): Omit<EcommerceResultRecord, 'errorText' | 'recovery'> {
  const { errorText: _oldError, recovery: _oldRecovery, ...rest } = result
  return rest
}

export function primaryAssetFields(primary: PrimaryAsset | undefined): Pick<
  EcommerceResultRecord,
  'assetHash' | 'mime' | 'width' | 'height'
> {
  if (!primary) return {}
  return {
    assetHash: primary.hash,
    mime: primary.mime,
    ...(primary.width ? { width: primary.width } : {}),
    ...(primary.height ? { height: primary.height } : {}),
  }
}

export function queuedSaveFor(
  result: EcommerceResultRecord,
  input: {
    planId: string
    prompt: string
    model: string
    assets: readonly GeneratedAsset[]
    errorText: string
    at: number
  },
): { result: EcommerceResultRecord; queued: QueuedAssetSave } {
  const next: EcommerceResultRecord = {
    ...withoutResultAttempt(result),
    status: 'failed',
    recovery: 'retry-save',
    prompt: input.prompt,
    model: input.model,
    errorText: input.errorText,
    updatedAt: input.at,
  }
  const queued: QueuedAssetSave = {
    id: result.id,
    projectId: result.projectId,
    resultId: result.id,
    taskId: result.taskId,
    planId: input.planId,
    prompt: input.prompt,
    model: input.model,
    assets: [...input.assets],
    createdAt: input.at,
    updatedAt: input.at,
    errorText: input.errorText,
  }
  return { result: next, queued }
}

export function retrySaveBlocksWrite(
  latestResult: EcommerceResultRecord | undefined,
  latestQueue: QueuedAssetSave | undefined,
  currentResult: EcommerceResultRecord,
  currentQueue: QueuedAssetSave,
): boolean {
  return (
    !latestResult ||
    !latestQueue ||
    latestResult.updatedAt !== currentResult.updatedAt ||
    latestQueue.updatedAt !== currentQueue.updatedAt ||
    latestResult.status !== 'failed' ||
    latestResult.recovery !== 'retry-save'
  )
}

export function failedRetrySave(
  latest: EcommerceResultRecord,
  message: string,
  at: number,
): EcommerceResultRecord {
  return {
    ...withoutResultFailure(latest),
    status: 'failed',
    recovery: 'retry-save',
    errorText: message,
    updatedAt: at,
  }
}

export function doneRetrySave(
  latest: EcommerceResultRecord,
  latestQueue: QueuedAssetSave,
  primary: PrimaryAsset | undefined,
  at: number,
): EcommerceResultRecord {
  return {
    ...withoutResultFailure(latest),
    status: 'done',
    prompt: latestQueue.prompt,
    model: latestQueue.model,
    ...(primary ? primaryAssetFields(primary) : {}),
    updatedAt: at,
  }
}
