/** 图片 / 视频质量参数的纯派生：输入节点数据、模型能力表与规格，不触发事件。 */
import { clampDuration, type ModelCapability } from '../../../../domain/shared/capability'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import { VIDEO_MODE_LABELS, type VideoModeId } from '../../../../domain/canvas/layout/videoParams'
import type { ImageParamSpec } from '../../../../domain/shared/modelParams/imageParams'
import type { VideoParamSpec } from '../../../../domain/storyboard/videoParams'
import {
  COUNT_OPTIONS,
  DEFAULT_DURATION,
  QUALITY_OPTIONS,
  RESOLUTION_CUSTOM,
  SIZE_OPTIONS,
  backgroundLabelOf as backgroundLabel,
  qualityLabelOf as qualityLabel,
  resolutionLabelOf as resolutionLabel,
  resolutionValueOf as resolutionValue,
  withFollowRatio,
} from './creationCatalog'
import { RATIO_FOLLOW_SOURCE } from '../../../../domain/canvas/layout/constants'
import { customSizeIssue } from '../../../../domain/canvas/layout/customSize'

export interface CreationQualityParams {
  ratios: string[]
  shownRatio: string
  resolutions: readonly string[]
  ladderResolutions: string[]
  maxCount: number
  count: number
  countChoices: readonly number[]
  qualityChoices: readonly string[]
  backgroundChoices: readonly string[]
  paramsLabel: string
  canCustomSize: boolean
  customResolutionOn: boolean
  resolutionPillValue: string
  customSizeHint?: { text: string; tone: 'muted' | 'error' }
  sizeChoices: { value: string; label: string }[]
  sizeValue: string
  sizeLabel: string
  minSec: number
  maxSec: number
  duration: number
  showDuration: boolean
  videoModeOptions: {
    value: VideoModeId
    label: string
    hint?: string
    disabled?: boolean
    title?: string
  }[]
  videoModeValue: VideoModeId
  showVideoMode: boolean
  videoCounts: readonly number[]
  videoCount: number
  showVideoCount: boolean
  showGenerateAudio: boolean
  generateAudio: boolean
}

export interface CreationQualityInput {
  data: GenerationData
  activeModel?: ModelCapability
  imageSpec?: ImageParamSpec
  videoSpec?: VideoParamSpec
  hasSourceImage: boolean
  customModeOn: boolean
}

export function customSizeHintOf(value: string): { text: string; tone: 'muted' | 'error' } | undefined {
  const issue = customSizeIssue(value)
  if (!issue) return undefined
  const text =
    issue === 'format'
      ? '格式：宽x高，例如 1024x1536'
      : issue === 'snap'
        ? '长和宽都要是 16 的倍数'
        : issue === 'edge'
          ? '最长边不能超过 3840'
          : issue === 'pixels'
            ? '总像素要在 655360–8294400 之间'
            : '长宽比不能超过 3:1'
  return { text, tone: value.trim() === '' ? 'muted' : 'error' }
}

export function deriveCreationQualityParams(input: CreationQualityInput): CreationQualityParams {
  const { data, activeModel, imageSpec, videoSpec, hasSourceImage, customModeOn } = input
  const ratios = withFollowRatio(
    videoSpec ? videoSpec.ratios : imageSpec ? imageSpec.ratios : [
      '1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21',
    ],
    hasSourceImage,
  )
  const storedRatio = String(data.ratio ?? '')
  const shownRatio = storedRatio === RATIO_FOLLOW_SOURCE && !hasSourceImage ? '' : storedRatio
  const resolutions: readonly string[] = imageSpec ? [...imageSpec.sizes] : ['auto', '1k', '2k', '4k']
  const declaredMax = activeModel?.maxCount
  const maxCount = imageSpec
    ? Math.max(...imageSpec.counts)
    : typeof declaredMax === 'number' && declaredMax > 0
      ? Math.max(1, declaredMax)
      : COUNT_OPTIONS[COUNT_OPTIONS.length - 1]
  const count = Math.max(1, Math.min(data.count ?? 1, maxCount))
  const countChoices: readonly number[] = imageSpec ? imageSpec.counts : COUNT_OPTIONS
  const qualityChoices = imageSpec ? imageSpec.qualities : QUALITY_OPTIONS.map((option) => option.value)
  const backgroundChoices: readonly string[] = imageSpec ? imageSpec.backgrounds : []
  const paramsLabel = [
    resolutions.length > 0 ? resolutionLabel(data.resolution ?? 'auto') : '',
    qualityChoices.length > 0 ? qualityLabel(data.quality ?? 'auto') : '',
    backgroundChoices.length > 0 ? backgroundLabel(data.background ?? 'auto') : '',
    ratios.length > 0 ? shownRatio || '比例' : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const canCustomSize = imageSpec?.dialect === 'openai-images'
  const ladderResolutions = resolutions.map(resolutionValue)
  const storedResolution = String(data.resolution ?? '')
  const storedIsCustomSize =
    storedResolution !== '' && !ladderResolutions.includes(storedResolution.toLowerCase())
  const customResolutionOn =
    canCustomSize &&
    (storedIsCustomSize || (customModeOn && !ladderResolutions.includes(storedResolution.toLowerCase())))
  const resolutionPillValue = customResolutionOn
    ? RESOLUTION_CUSTOM
    : ladderResolutions.includes(storedResolution.toLowerCase())
      ? storedResolution.toLowerCase()
      : storedResolution

  const sizeChoices = videoSpec
    ? videoSpec.sizes.map((size) => ({ value: size, label: size.toUpperCase() }))
    : SIZE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
  const sizeValue =
    data.size && sizeChoices.some((choice) => choice.value === data.size)
      ? data.size
      : videoSpec
        ? (sizeChoices[0]?.value ?? 'auto')
        : (data.size ?? 'auto')
  const sizeLabel = sizeChoices.find((choice) => choice.value === sizeValue)?.label ?? '清晰度'
  const secondsRange = videoSpec?.seconds
  const [minSec, maxSec] = secondsRange
    ? [secondsRange.min, secondsRange.max]
    : (activeModel?.durations ?? [3, 15])
  const duration = secondsRange
    ? Math.min(secondsRange.max, Math.max(secondsRange.min, Math.round(data.durationSec ?? secondsRange.default)))
    : clampDuration(data.durationSec ?? DEFAULT_DURATION, activeModel)
  const showDuration = Boolean(secondsRange) || !videoSpec

  const modeIds: readonly VideoModeId[] = videoSpec
    ? videoSpec.modes
    : (['text', 'all-purpose', 'first-last-frame'] as const)
  const storedMode: VideoModeId | undefined =
    (typeof data.videoMode === 'string' ? (data.videoMode as VideoModeId) : undefined) ??
    (data.refMode === 'first-last-frame' || data.refMode === 'all-purpose' ? data.refMode : undefined)
  const disabledModes = new Set<string>(videoSpec?.disabledModes ?? [])
  const enabledModes = modeIds.filter((id) => !disabledModes.has(id))
  const videoModeValue: VideoModeId =
    storedMode && enabledModes.includes(storedMode)
      ? storedMode
      : (enabledModes[0] ?? modeIds[0] ?? 'text')
  const videoModeOptions = modeIds.map((id) => {
    const meta = VIDEO_MODE_LABELS[id]
    const agnesReference = id === 'all-purpose' && videoSpec?.dialect !== 'openai-videos'
    return {
      value: id,
      label: meta.beta ? `${meta.label} Beta` : meta.label,
      ...(agnesReference
        ? { hint: '参考图按连线顺序编号；提示词里可用 <Picture 1> 指代第 1 张' }
        : {}),
      ...(disabledModes.has(id)
        ? { disabled: true, title: `${meta.label}：当前模型不支持这一档` }
        : {}),
    }
  })
  const videoCounts: readonly number[] = videoSpec ? videoSpec.counts : [1]
  const videoMaxCount = Math.max(...videoCounts)
  const videoCount = Math.max(1, Math.min(Math.round(data.count ?? 1), videoMaxCount))

  return {
    ratios,
    shownRatio,
    resolutions,
    ladderResolutions,
    maxCount,
    count,
    countChoices,
    qualityChoices,
    backgroundChoices,
    paramsLabel,
    canCustomSize,
    customResolutionOn,
    resolutionPillValue,
    customSizeHint: customSizeHintOf(storedResolution),
    sizeChoices,
    sizeValue,
    sizeLabel,
    minSec,
    maxSec,
    duration,
    showDuration,
    videoModeOptions,
    videoModeValue,
    showVideoMode: modeIds.length > 1,
    videoCounts,
    videoCount,
    showVideoCount: videoCounts.length > 1,
    showGenerateAudio: videoSpec?.supportsAudio === true,
    generateAudio: data.generateAudio ?? true,
  }
}
