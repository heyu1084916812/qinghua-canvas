import { ECOMMERCE_UPSCALE_OPTIONS } from '../../../../domain/ecommerce/upscale'
import type {
  EcommerceUpscaleProfile,
  EcommerceUpscaleScale,
} from '../../../../domain/ecommerce/upscale'
import type { EcommerceResultItem, EcommerceUpload } from '../studioContracts'

export interface StudioEditOptions {
  referenceNodeId?: string
  model?: string
}

export interface StudioEditSubmission {
  instruction: string
  options: StudioEditOptions
}

export function studioEditSubmission(
  instruction: string,
  reference: EcommerceUpload | null,
  model: string,
): StudioEditSubmission | { error: string } {
  const normalized = instruction.trim()
  if (!normalized) {
    return {
      error: '先写清这一张要改什么，例如：只把背景换成海边日落，产品和文字保持不变',
    }
  }
  return {
    instruction: normalized,
    options: {
      ...(reference ? { referenceNodeId: reference.nodeId } : {}),
      ...(model ? { model } : {}),
    },
  }
}

export interface StudioBatchEditSubmission {
  imageNodeIds: readonly string[]
  instruction: string
  options: StudioEditOptions
}

export function studioBatchEditSubmission(input: {
  instruction: string
  results: readonly EcommerceResultItem[]
  selectedNodeIds: ReadonlySet<string>
  reference: EcommerceUpload | null
  model: string
}): StudioBatchEditSubmission | { error: string } {
  const instruction = input.instruction.trim()
  if (!instruction) return { error: '先写清这批图要统一改什么' }
  const imageNodeIds = input.results
    .filter(
      (result) =>
        result.status === 'done' &&
        input.selectedNodeIds.has(result.nodeId) &&
        !result.mime?.startsWith('video/'),
    )
    .map((result) => result.nodeId)
  if (imageNodeIds.length === 0) return { error: '先选择至少一张结果' }
  return {
    imageNodeIds,
    instruction,
    options: {
      ...(input.reference ? { referenceNodeId: input.reference.nodeId } : {}),
      ...(input.model ? { model: input.model } : {}),
    },
  }
}

export interface StudioUpscaleProgress {
  completed: number
  error: string | null
}

export async function runStudioUpscale(input: {
  items: readonly EcommerceResultItem[]
  profile: EcommerceUpscaleProfile
  scale: EcommerceUpscaleScale
  onUpscale: (
    nodeId: string,
    profile: EcommerceUpscaleProfile,
    scale: EcommerceUpscaleScale,
  ) => Promise<void>
}): Promise<StudioUpscaleProgress> {
  let completed = 0
  try {
    for (const item of input.items) {
      await input.onUpscale(item.nodeId, input.profile, input.scale)
      completed += 1
    }
    return { completed, error: null }
  } catch (error) {
    const done = completed > 0 ? `已完成 ${completed}/${input.items.length} 张；` : ''
    const reason = error instanceof Error ? error.message : 'AI 超清失败，原因见下方结果区'
    return { completed, error: `${done}${reason}` }
  }
}

export function availableStudioUpscaleOptions(
  profiles: readonly EcommerceUpscaleProfile[] | undefined,
): typeof ECOMMERCE_UPSCALE_OPTIONS {
  const available = new Set(
    profiles ?? ECOMMERCE_UPSCALE_OPTIONS.map((option) => option.id),
  )
  return ECOMMERCE_UPSCALE_OPTIONS.filter((option) => available.has(option.id))
}

export function studioEditableResult(
  result: EcommerceResultItem,
  running: boolean,
  hasEdit: boolean,
): boolean {
  return hasEdit && !running && !result.mime?.startsWith('video/')
}

export function studioUpscalableResult(
  result: EcommerceResultItem,
  running: boolean,
  hasUpscale: boolean,
  optionCount: number,
): boolean {
  return hasUpscale && !running && !result.mime?.startsWith('video/') && optionCount > 0
}

export function studioUploadPreviewItems(
  preview: { kind: 'product' | 'reference'; index: number } | null,
  products: readonly EcommerceUpload[],
  references: readonly EcommerceUpload[],
): readonly EcommerceUpload[] {
  return preview?.kind === 'product'
    ? products
    : preview?.kind === 'reference'
      ? references
      : []
}

export function studioUploadPreviewStep(
  current: { kind: 'product' | 'reference'; index: number } | null,
  delta: -1 | 1,
  itemCount: number,
): { kind: 'product' | 'reference'; index: number } | null {
  if (!current) return current
  const index = current.index + delta
  if (index < 0 || index >= itemCount) return current
  return { ...current, index }
}

export function studioEditFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'AI 编辑失败，原因见下方结果区'
}

export function studioBatchEditFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : '批量 AI 编辑失败'
}

export function studioUploadFailureMessage(): string {
  return '参考图没能读进来（格式不支持或读取失败）'
}
