import { shouldExpandShots } from '../../../../domain/ecommerce/chatShots'
import {
  batchWhiteOutputError,
  buildEcommerceModeOptionsPrompt,
  modeOptionString,
} from '../../../../domain/ecommerce/modeOptions'
import { EcommerceRequestError, buildEcommercePlan } from '../../../../domain/ecommerce/plan'
import type { EcommerceModeFormState } from '../../../../domain/ecommerce/draft'
import type {
  EcommerceLanguage,
  EcommerceModeOptions,
  EcommerceRequest,
  EcommerceUsage,
} from '../../../../domain/ecommerce/types'
import type { EcommerceUpload, StudioMode } from '../studioContracts'

export interface BuildStudioRequestInput {
  mode: StudioMode
  modeOptions: EcommerceModeOptions
  usage: EcommerceUsage
  form: EcommerceModeFormState
  effectiveCount: number
  videoDuration: number
  products: readonly EcommerceUpload[]
  references: readonly EcommerceUpload[]
  model: string
}

export function buildStudioRequest(input: BuildStudioRequestInput): EcommerceRequest {
  const modePrompt = [input.mode.promptPrefix, buildEcommerceModeOptionsPrompt(input.mode.id, input.modeOptions)]
    .filter((item): item is string => !!item?.trim())
    .join('\n')
  return {
    mediaKind: input.mode.mediaKind,
    modeLabel: input.mode.label,
    modeOptions: input.modeOptions,
    usage: input.usage,
    platformId: input.form.platformId || undefined,
    language: input.form.language,
    count: input.mode.mediaKind === 'video' ? 1 : input.effectiveCount,
    ratio: input.form.ratio,
    ...(input.mode.mediaKind === 'image' && input.form.resolution !== 'auto'
      ? { resolution: input.form.resolution }
      : {}),
    ...(input.mode.mediaKind === 'image' && input.form.quality !== 'auto'
      ? { quality: input.form.quality }
      : {}),
    productNodeId: input.products[0]?.nodeId ?? '',
    productNodeIds: input.products.map((item) => item.nodeId),
    referenceNodeIds: input.references.map((item) => item.nodeId),
    note: input.form.note,
    ...(modePrompt ? { modePrompt } : {}),
    ...(input.mode.mediaKind === 'video' ? { durationSec: input.videoDuration } : {}),
    ...(input.model ? { model: input.model } : {}),
  }
}

export interface StudioStartValidationInput {
  mode: StudioMode
  modeOptions: EcommerceModeOptions
  products: readonly EcommerceUpload[]
  references: readonly EcommerceUpload[]
  effectiveCount: number
  batchWhite: boolean
  chatTargetLabel: string
  request: EcommerceRequest
}

export function validateStudioStart(input: StudioStartValidationInput): string | null {
  if (input.products.length === 0) {
    return '先上传一张产品图 —— 没有产品图就没有可改的主体'
  }
  if (!input.batchWhite && input.products.length > 3) {
    return '单张白底模式最多用 3 张商品图；要保留更多源图，请切回批量白底'
  }
  if (input.batchWhite) {
    const batchLimitError = batchWhiteOutputError(input.products.length, input.effectiveCount)
    if (batchLimitError) return batchLimitError
  }
  if (
    (input.mode.id === 'product-recreate' ||
      input.mode.id === 'video-recreate' ||
      input.mode.id === 'wear-tryon') &&
    input.references.length === 0
  ) {
    return input.mode.id === 'video-recreate'
      ? '先上传一段参考视频'
      : input.mode.id === 'wear-tryon'
        ? '先上传一张人物参考图'
        : '先上传一张爆款参考图'
  }
  if (
    (input.mode.id === 'video-commerce' || input.mode.id === 'wear-model') &&
    modeOptionString(input.modeOptions, 'modelSource', 'ai') === 'upload' &&
    input.references.length === 0
  ) {
    return '先上传一张模特参考图，或把模特来源切回 AI 生成'
  }
  try {
    buildEcommercePlan(input.request)
  } catch (error) {
    return error instanceof EcommerceRequestError
      ? error.message
      : '这次参数没有通过校验，请检查后再试'
  }
  if (shouldExpandShots(input.request) && !input.chatTargetLabel) {
    return '这类商品图需要先用对话模型分析商品原图并写逐张提示词。请先在右侧「对话模型」配置渠道，再生成。'
  }
  return null
}

export function studioRequestForProduct(
  request: EcommerceRequest,
  product: EcommerceUpload,
): EcommerceRequest {
  return {
    ...request,
    productNodeId: product.nodeId,
    productNodeIds: [product.nodeId],
    referenceNodeIds: [],
  }
}

export function usesAiPlan(
  confirming: boolean,
  chatTargetLabel: string,
  request: EcommerceRequest,
): boolean {
  return confirming && chatTargetLabel ? shouldExpandShots(request) : false
}

export interface StudioSubmissionInput {
  batchWhite: boolean
  products: readonly EcommerceUpload[]
  request: EcommerceRequest
  onGenerate: (request: EcommerceRequest) => Promise<void>
}

export async function submitStudioGeneration(
  input: StudioSubmissionInput,
): Promise<void> {
  if (input.batchWhite) {
    for (const product of input.products) {
      await input.onGenerate(studioRequestForProduct(input.request, product))
    }
    return
  }
  await input.onGenerate(input.request)
}

export interface StudioUploadCapacityInput {
  batchWhite: boolean
  productLimit: number
  productCount: number
  referenceCount: number
}

export function appendProductUpload<T extends EcommerceUpload>(
  current: T[],
  uploaded: T,
  input: StudioUploadCapacityInput,
): T[] {
  if (current.some((item) => item.nodeId === uploaded.nodeId)) return current
  if (current.length >= input.productLimit) return current
  if (!input.batchWhite && current.length + input.referenceCount >= 4) return current
  return [...current, uploaded]
}

export function appendReferenceUpload<T extends EcommerceUpload>(
  current: T[],
  uploaded: T,
  productCount: number,
): T[] {
  if (current.some((item) => item.nodeId === uploaded.nodeId)) return current
  if (current.length + productCount >= 4 || current.length >= 4) return current
  return [...current, uploaded]
}

export function uploadRoom(
  kind: 'product' | 'reference',
  input: {
    batchWhite: boolean
    productLimit: number
    productCount: number
    referenceCount: number
  },
): number {
  if (kind === 'product') {
    return Math.max(
      0,
      (input.batchWhite
        ? input.productLimit
        : Math.min(input.productLimit, 4 - input.referenceCount)) - input.productCount,
    )
  }
  return Math.max(0, Math.min(4 - input.referenceCount, 4 - input.productCount))
}

export function uploadFailureMessage(
  error: unknown,
  fallback = '生成失败，原因见下方结果区',
): string {
  return error instanceof Error ? error.message : fallback
}

export function sellingPointFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AI 帮写失败，请稍后重试'
}

export function studioRequestLanguage(
  language: EcommerceLanguage,
): EcommerceLanguage {
  return language
}
