import type { GeneratedAsset } from '../../../platform/channels/types'
import type { EcommerceResultRecord } from '../../../domain/ecommerce/tasks'

export interface QueuedAssetSave {
  id: string
  projectId: string
  resultId: string
  taskId: string
  planId: string
  prompt: string
  model: string
  assets: readonly GeneratedAsset[]
  createdAt: number
  updatedAt: number
  errorText?: string
}

export interface RetryAssetSaveResult {
  ok: boolean
  result: EcommerceResultRecord | null
  errorText?: string
}
