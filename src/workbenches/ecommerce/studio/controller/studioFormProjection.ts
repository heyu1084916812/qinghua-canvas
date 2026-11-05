import { ECOMMERCE_PLATFORM_ORDER, type EcommercePlatform } from '../../../../domain/ecommerce/platforms'
import { DEFAULT_ECOMMERCE_FORM_DRAFT, type EcommerceFormDraft, type EcommerceModeFormState } from '../../../../domain/ecommerce/draft'
import {
  defaultEcommerceModeOptions,
  ecommerceModeCount,
  modeOptionString,
  modeOptionStrings,
  normalizeEcommerceModeOptions,
} from '../../../../domain/ecommerce/modeOptions'
import type {
  EcommerceLanguage,
  EcommerceModeOptionValue,
  EcommerceModeOptions,
  EcommerceUsage,
} from '../../../../domain/ecommerce/types'
import {
  DEFAULT_MODE_FORM_STATE,
  STUDIO_MODES,
  type EcommerceResultItem,
  type EcommerceUpload,
  type StudioCategory,
  type StudioMode,
} from '../studioContracts'

export interface StudioInitialFormState {
  initialMode: StudioMode
  category: StudioCategory
  modeId: string
  videoDuration: number
  usage: EcommerceUsage
  modeStates: Record<string, EcommerceModeFormState>
  modeOptionsByMode: Record<string, EcommerceModeOptions>
}

export interface StudioFormProjection {
  mode: StudioMode
  modeFormState: EcommerceModeFormState
  modeOptions: EcommerceModeOptions
  effectiveCount: number
  batchWhite: boolean
  productLimit: number
  batchOutputCount: number
  categoryModes: readonly StudioMode[]
  visibleResults: readonly EcommerceResultItem[]
}

export function initialStudioFormState(
  savedDraft: EcommerceFormDraft | null,
): StudioInitialFormState {
  const saved = savedDraft ?? DEFAULT_ECOMMERCE_FORM_DRAFT
  const mediaKind = saved.mediaKind ?? 'image'
  const initialMode =
    STUDIO_MODES.find(
      (item) => item.label === saved.modeLabel && item.mediaKind === mediaKind,
    ) ??
    STUDIO_MODES.find(
      (item) => item.usage === saved.usage && item.mediaKind === mediaKind,
    ) ??
    STUDIO_MODES[0]
  return {
    initialMode,
    category: initialMode.category,
    modeId: initialMode.id,
    videoDuration: saved.videoDuration ?? 5,
    usage: saved.usage,
    modeStates: {
      ...saved.modeStates,
      [initialMode.id]: {
        platformId: saved.platformId,
        language: saved.language,
        ratio: saved.ratio,
        resolution: saved.resolution,
        quality: saved.quality,
        note: saved.note,
      },
    },
    modeOptionsByMode: {
      [initialMode.id]: {
        ...defaultEcommerceModeOptions(initialMode.id),
        ...normalizeEcommerceModeOptions(saved.modeOptions),
      },
    },
  }
}

export function applyModeFormPatch(
  current: Record<string, EcommerceModeFormState>,
  mode: StudioMode,
  patch: Partial<EcommerceModeFormState>,
): Record<string, EcommerceModeFormState> {
  return {
    ...current,
    [mode.id]: {
      ...(current[mode.id] ?? DEFAULT_MODE_FORM_STATE(mode)),
      ...patch,
    },
  }
}

export function setStudioModeOption(
  options: EcommerceModeOptions,
  key: string,
  value: EcommerceModeOptionValue,
): EcommerceModeOptions {
  return { ...options, [key]: value }
}

export function toggleStudioModeOption(
  options: EcommerceModeOptions,
  key: string,
  id: string,
): EcommerceModeOptions {
  const current = modeOptionStrings(options, key)
  return setStudioModeOption(
    options,
    key,
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
  )
}

export function ensureStudioModeState<T>(
  current: Record<string, T>,
  mode: StudioMode,
  next: T,
): Record<string, T> {
  return current[mode.id] ? current : { ...current, [mode.id]: next }
}

export function projectStudioForm(input: {
  modeId: string
  category: StudioCategory
  fallbackMode: StudioMode
  modeStates: Record<string, EcommerceModeFormState>
  modeOptionsByMode: Record<string, EcommerceModeOptions>
  products: readonly EcommerceUpload[]
  results: readonly EcommerceResultItem[]
}): StudioFormProjection {
  const mode = STUDIO_MODES.find((item) => item.id === input.modeId) ?? input.fallbackMode
  const modeFormState =
    input.modeStates[mode.id] ?? DEFAULT_MODE_FORM_STATE(mode)
  const modeOptions =
    input.modeOptionsByMode[mode.id] ?? defaultEcommerceModeOptions(mode.id)
  const effectiveCount = ecommerceModeCount(mode.id, mode.count, modeOptions)
  const batchWhite =
    mode.id === 'product-white' &&
    modeOptionString(modeOptions, 'whiteBatch', 'off') === 'on'
  const visibleResults = input.results.filter((result) =>
    mode.mediaKind === 'video'
      ? result.mime?.startsWith('video/')
      : !result.mime?.startsWith('video/'),
  )
  return {
    mode,
    modeFormState,
    modeOptions,
    effectiveCount,
    batchWhite,
    productLimit: batchWhite ? 12 : 3,
    batchOutputCount: batchWhite ? input.products.length * effectiveCount : effectiveCount,
    categoryModes: STUDIO_MODES.filter((item) => item.category === input.category),
    visibleResults,
  }
}

export function studioFormDraft(input: {
  mode: StudioMode
  videoDuration: number
  usage: EcommerceUsage
  modeFormState: EcommerceModeFormState
  effectiveCount: number
  model: string
  modeOptions: EcommerceModeOptions
  modeStates: Record<string, EcommerceModeFormState>
  products: readonly EcommerceUpload[]
  references: readonly EcommerceUpload[]
}): EcommerceFormDraft {
  return {
    modeLabel: input.mode.label,
    mediaKind: input.mode.mediaKind,
    videoDuration: input.videoDuration,
    usage: input.usage,
    platformId: input.modeFormState.platformId,
    language: input.modeFormState.language,
    count: input.effectiveCount,
    ratio: input.modeFormState.ratio,
    resolution: input.modeFormState.resolution,
    quality: input.modeFormState.quality,
    note: input.modeFormState.note,
    model: input.model,
    modeOptions: input.modeOptions,
    modeStates: {
      ...input.modeStates,
      [input.mode.id]: input.modeFormState,
    },
    productNodeId: input.products[0]?.nodeId ?? null,
    productNodeIds: input.products.map((item) => item.nodeId),
    referenceNodeIds: input.references.map((item) => item.nodeId),
  }
}

export function orderedStudioPlatforms(
  platforms: readonly EcommercePlatform[],
): EcommercePlatform[] {
  const rank = new Map(ECOMMERCE_PLATFORM_ORDER.map((id, index) => [id, index]))
  return [...platforms].sort(
    (left, right) =>
      (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.name.localeCompare(right.name, 'zh-CN'),
  )
}

export function pruneSelectedEditNodes(
  current: ReadonlySet<string>,
  results: readonly EcommerceResultItem[],
): Set<string> {
  const valid = new Set(
    results.filter((result) => result.status === 'done').map((result) => result.nodeId),
  )
  const next = new Set([...current].filter((id) => valid.has(id)))
  return next.size === current.size && [...next].every((id) => current.has(id))
    ? new Set(current)
    : next
}

export function nextModeFormAfterModelChange(
  imageParamOptionsByModel: Readonly<Record<string, { resolutions: readonly string[]; qualities: readonly string[] }>>,
  nextModel: string,
  current: Pick<EcommerceModeFormState, 'resolution' | 'quality'>,
): Pick<EcommerceModeFormState, 'resolution' | 'quality'> {
  const nextOptions = imageParamOptionsByModel[nextModel] ?? {
    resolutions: ['1K', '2K', '4K'],
    qualities: [],
  }
  return {
    resolution: nextOptions.resolutions.includes(current.resolution) ? current.resolution : 'auto',
    quality: nextOptions.qualities.includes(current.quality) ? current.quality : 'auto',
  }
}

export interface StudioFieldVisibility {
  referenceRequired: boolean
  showReferenceBlock: boolean
  referenceLabel: string
  showCommonFields: boolean
  showSellingPoints: boolean
  showPlatformAndLanguage: boolean
  showLanguageField: boolean
  showRatioField: boolean
  showResolutionField: boolean
  showQualityField: boolean
}

export function studioFieldVisibility(
  mode: StudioMode,
  qualityChoices: readonly unknown[],
): StudioFieldVisibility {
  const referenceRequired =
    mode.id === 'product-recreate' ||
    mode.id === 'video-recreate' ||
    mode.id === 'wear-tryon'
  return {
    referenceRequired,
    showReferenceBlock:
      referenceRequired ||
      mode.id === 'wear-model' ||
      mode.id === 'video-commerce',
    referenceLabel:
      mode.id === 'video-recreate'
        ? '参考视频'
        : mode.id === 'wear-tryon'
          ? '人物参考图'
          : mode.id === 'wear-model' || mode.id === 'video-commerce'
            ? '模特参考图'
            : '参考图（爆款图）',
    showCommonFields: ![
      'product-retouch',
      'product-recolor',
      'wear-model',
      'wear-tryon',
      'wear-detail',
    ].includes(mode.id),
    showSellingPoints: ![
      'product-recolor',
      'wear-model',
      'wear-tryon',
      'wear-detail',
      'product-white',
    ].includes(mode.id),
    showPlatformAndLanguage:
      mode.id !== 'wear-set' && mode.id !== 'product-white',
    showLanguageField: mode.id !== 'product-white',
    showRatioField: mode.id !== 'wear-set',
    showResolutionField: mode.mediaKind === 'image',
    showQualityField: mode.mediaKind === 'image' && qualityChoices.length > 1,
  }
}

export interface StudioImageParameterChoice {
  value: string
  label: string
}

const QUALITY_LABELS: Readonly<Record<string, string>> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极致',
}

export function studioImageParameterChoices(
  imageParamOptionsByModel: Readonly<Record<string, { resolutions: readonly string[]; qualities: readonly string[] }>>,
  model: string,
): {
  imageParamOptions: { resolutions: readonly string[]; qualities: readonly string[] }
  resolutionChoices: StudioImageParameterChoice[]
  qualityChoices: StudioImageParameterChoice[]
} {
  const imageParamOptions = imageParamOptionsByModel[model] ?? {
    resolutions: ['1K', '2K', '4K'],
    qualities: [],
  }
  return {
    imageParamOptions,
    resolutionChoices: [
      { value: 'auto', label: '自动' },
      ...imageParamOptions.resolutions
        .filter((value) => value !== 'auto')
        .map((value) => ({ value, label: value })),
    ],
    qualityChoices: [
      { value: 'auto', label: '自动' },
      ...imageParamOptions.qualities.map((value) => ({
        value,
        label: QUALITY_LABELS[value] ?? value,
      })),
    ],
  }
}

export function studioEditPresets(
  language: EcommerceLanguage,
  usage: EcommerceUsage,
  languageLabel: (language: EcommerceLanguage, usage: EcommerceUsage) => string,
): ReadonlyArray<{ key: string; label: string; instruction: string }> {
  return [
    {
      key: 'cleanup',
      label: '清理杂物',
      instruction:
        '只去掉画面中与产品无关的杂物、污点与干扰元素，产品和画面文字保持原样。',
    },
    {
      key: 'white-bg',
      label: '纯白背景',
      instruction:
        '只把背景换成纯白背景，产品边缘保持干净，产品外观、构图与画面文字不变。',
    },
    {
      key: 'light',
      label: '统一光线',
      instruction:
        '只优化光线与清晰度，让产品受光更均匀、材质更清楚；构图、产品和文字不变。',
    },
    {
      key: 'translate',
      label: `翻译成${languageLabel(language, usage)}`,
      instruction:
        `只把画面中的文字翻译成${languageLabel(language, usage)}，保持原有排版、字号与视觉层级；` +
        '产品和背景不变，不新增无法核实的文案。',
    },
    {
      key: 'text-edit',
      label: '替换画面文字',
      instruction:
        '只把画面中明确指定的文字“旧文字”替换为“新文字”；保持原有字体风格、字号、排版位置与视觉层级。' +
        '其他文字、产品和背景不变，不新增无法核实的文案。',
    },
  ]
}

export interface StudioCarouselCase {
  id: string
  title: string
  tag: string
  tiles: readonly string[]
}

export function studioCarouselCases(mode: StudioMode): readonly StudioCarouselCase[] {
  return [
    {
      id: 'case-1',
      title: mode.mediaKind === 'video' ? '短视频案例' : `${mode.label}案例`,
      tag: '商品原图',
      tiles:
        mode.mediaKind === 'video'
          ? ['开场展示', '产品演示', '卖点口播']
          : ['白底主图', '核心卖点', '细节特写'],
    },
    {
      id: 'case-2',
      title: mode.mediaKind === 'video' ? '场景短片案例' : '场景套图案例',
      tag: '场景延展',
      tiles:
        mode.mediaKind === 'video'
          ? ['场景建立', '使用过程', '收尾展示']
          : ['使用场景', '多角度图', '质感特写'],
    },
    {
      id: 'case-3',
      title: mode.mediaKind === 'video' ? '带货视频案例' : '详情页案例',
      tag: '详情结构',
      tiles:
        mode.mediaKind === 'video'
          ? ['痛点开场', '产品解决', '行动引导']
          : ['首屏主视觉', '规格参数', '售后说明'],
    },
  ]
}
