import type { ReactNode } from 'react'
import type { EcommerceIntentDraft } from '../../../domain/ecommerce/chatParse'
import type { EcommerceShot } from '../../../domain/ecommerce/prompt'
import type { EcommerceGenerationStage } from '../../../domain/ecommerce/progress'
import type { EcommercePlanSession } from '../../../domain/ecommerce/sessions'
import type { EcommerceTaskRecord } from '../../../domain/ecommerce/tasks'
import type { EcommerceFormDraft, EcommerceModeFormState } from '../../../domain/ecommerce/draft'
import type {
  EcommerceRequest,
  EcommerceUsage,
} from '../../../domain/ecommerce/types'
import type { EcommercePlatform } from '../../../domain/ecommerce/platforms'
import type { EcommerceUpscaleProfile, EcommerceUpscaleScale } from '../../../domain/ecommerce/upscale'
import type { ShotPlanResult } from '../../../domain/ecommerce/chatShots'

export interface EcommerceUpload {
  nodeId: string
  hash: string
  preview: ReactNode
  width?: number
  height?: number
}

export interface EcommerceImageParamOptions {
  resolutions: readonly string[]
  qualities: readonly string[]
}

export interface EcommerceResultItem {
  nodeId: string
  resultId?: string
  status: 'running' | 'done' | 'failed'
  recovery?: 'retry-save'
  mime?: string
  error?: string
  preview?: ReactNode
  sourcePreview?: ReactNode
  prompt?: string
  model?: string
  ratio?: string
  shotTitle?: string
  brief?: string
  headline?: string
  subheadline?: string
  visualSystem?: string
  note?: string
  createdAt?: number
  imageHash?: string
  pixelSize?: { width: number; height: number } | null
  onDownload?: () => void
  onRerun?: () => Promise<void> | void
  onRetrySave?: () => Promise<void> | void
  onRemoveFailed?: () => void
  onReplace?: () => Promise<void> | void
  onSaveToLibrary?: () => Promise<void> | void
}

export type StudioCategory = 'product' | 'video' | 'wear'

export interface StudioMode {
  id: string
  category: StudioCategory
  label: string
  usage: EcommerceUsage
  count: number
  mediaKind: 'image' | 'video'
  ratio?: string
  promptPrefix?: string
}

export const STUDIO_CATEGORIES: readonly { id: StudioCategory; label: string }[] = [
  { id: 'product', label: '商品' },
  { id: 'video', label: '视频' },
  { id: 'wear', label: '穿戴' },
]

export const STUDIO_MODES: readonly StudioMode[] = [
  { id: 'product-set', category: 'product', label: '商品套图', usage: 'set', count: 8, mediaKind: 'image' },
  { id: 'product-detail', category: 'product', label: 'A+ 详情页', usage: 'detail', count: 4, mediaKind: 'image' },
  { id: 'product-recreate', category: 'product', label: '爆款复刻', usage: 'recreate', count: 4, mediaKind: 'image' },
  { id: 'product-white', category: 'product', label: '白底图', usage: 'white-bg', count: 1, mediaKind: 'image', ratio: '1:1' },
  {
    id: 'product-retouch',
    category: 'product',
    label: '产品精修',
    usage: 'main',
    count: 1,
    mediaKind: 'image',
    promptPrefix: '做专业商品精修：只优化产品本身的光泽、瑕疵、清晰度与透视，保持产品外观、颜色、材质和结构不变。',
  },
  {
    id: 'product-recolor',
    category: 'product',
    label: '产品换色',
    usage: 'main',
    count: 1,
    mediaKind: 'image',
    promptPrefix: '只替换产品的主色，保持产品造型、材质、结构、镜头、背景和画面文字不变；不要新增品牌标识。',
  },
  {
    id: 'video-recreate',
    category: 'video',
    label: '视频复刻',
    usage: 'recreate',
    count: 1,
    mediaKind: 'video',
    ratio: '9:16',
    promptPrefix: '参考素材只借镜头、节奏、景别、转场和光线；商品主体必须来自产品图，不复制品牌、人物身份和水印。',
  },
  {
    id: 'video-commerce',
    category: 'video',
    label: '带货视频',
    usage: 'set',
    count: 1,
    mediaKind: 'video',
    ratio: '9:16',
    promptPrefix: '生成一条简洁的电商带货短视频：开头快速展示商品，随后展示核心卖点与使用场景，镜头自然连续。',
  },
  {
    id: 'wear-set',
    category: 'wear',
    label: '服装组图',
    usage: 'set',
    count: 6,
    mediaKind: 'image',
    promptPrefix: '保持服装版型、颜色、面料、图案和结构不变，生成完整的服装电商展示组图。',
  },
  {
    id: 'wear-model',
    category: 'wear',
    label: '模特穿搭',
    usage: 'set',
    count: 4,
    mediaKind: 'image',
    promptPrefix: '让模特自然穿着产品图里的服装，保持服装版型、颜色、图案和细节一致；可用参考图控制模特形象。',
  },
  {
    id: 'wear-tryon',
    category: 'wear',
    label: '试穿换装',
    usage: 'main',
    count: 1,
    mediaKind: 'image',
    promptPrefix: '把产品图里的服装自然穿到参考人物身上，保持服装颜色、图案、版型和材质一致，不改变人物身份。',
  },
  {
    id: 'wear-detail',
    category: 'wear',
    label: '服装细节',
    usage: 'detail',
    count: 4,
    mediaKind: 'image',
    promptPrefix: '围绕服装的领口、袖口、走线、面料纹理和版型生成细节展示图，保持与产品图完全一致。',
  },
]

export interface EcommerceLongImageTools {
  busy?: boolean
  editResult?: (nodeId: string) => void
  upscaleResult?: (nodeId: string) => void
}

export interface EcommerceStudioProps {
  projectName: string
  initialDraft?: EcommerceFormDraft | null
  initialProducts?: readonly EcommerceUpload[]
  initialReferences?: readonly EcommerceUpload[]
  onDraftChange?: (draft: EcommerceFormDraft) => void
  platforms?: readonly EcommercePlatform[]
  onUpload: (file: File, kind: 'product' | 'reference') => Promise<EcommerceUpload | null>
  onWriteSellingPoints?: (request: EcommerceRequest) => Promise<string>
  onGenerate: (request: EcommerceRequest, shotPlan?: readonly EcommerceShot[]) => Promise<void>
  onEditResult?: (
    nodeId: string,
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => Promise<void>
  onEditResults?: (
    nodeIds: readonly string[],
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => Promise<void>
  onUpscaleResult?: (
    nodeId: string,
    profile: EcommerceUpscaleProfile,
    scale: EcommerceUpscaleScale,
  ) => Promise<void>
  upscaleProfiles?: readonly EcommerceUpscaleProfile[]
  models?: readonly string[]
  videoModels?: readonly string[]
  imageParamOptionsByModel?: Readonly<Record<string, EcommerceImageParamOptions>>
  editModels?: readonly string[]
  model: string
  onModelChange: (model: string) => void
  running: boolean
  results: readonly EcommerceResultItem[]
  workbench?: ReactNode
  onRetryFailed?: () => void
  failedCount?: number
  onDownloadAll?: () => void
  downloadableCount?: number
  onOpenLongImage?: () => void
  longImage?: (tools: EcommerceLongImageTools) => ReactNode
  onParseIntent?: (text: string) => Promise<void>
  parsingIntent?: boolean
  intent?: EcommerceIntentDraft | null
  chatTargetLabel?: string
  chatModels?: readonly string[]
  intentModel?: string
  onIntentModelChange?: (model: string) => void
  onConfigureChannels?: () => void
  intentError?: string
  onIntentApplied?: () => void
  onIntentDiscard?: () => void
  planHistory?: readonly EcommercePlanSession[]
  onRestorePlan?: (plan: EcommercePlanSession) => void
  onRemovePlan?: (id: string) => void
  taskHistory?: readonly EcommerceTaskRecord[]
  activeTaskId?: string
  onSelectTask?: (taskId: string) => void
  onRemoveTask?: (taskId: string) => void
  onPlanShots?: (request: EcommerceRequest) => Promise<ShotPlanResult>
  shotPlanNote?: string
  generationStage?: EcommerceGenerationStage | null
  textRecordWarning?: string
}

export const DEFAULT_MODE_FORM_STATE = (mode: StudioMode): EcommerceModeFormState => ({
  platformId: 'amazon',
  language: 'en',
  ratio:
    mode.id === 'product-set'
      ? 'smart'
      : mode.usage === 'detail'
        ? 'aplus-premium-web'
        : (mode.ratio ?? '1:1'),
  resolution: 'auto',
  quality: 'auto',
  note: '',
})
