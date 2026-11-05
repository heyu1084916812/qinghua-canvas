/** 面板档位目录与纯函数：不读 store、不读 DOM，只决定展示候选与文案。 */
import type { ModelCapability } from '../../../../domain/shared/capability'
import { RATIO_FOLLOW_SOURCE } from '../../../../domain/canvas/layout/constants'

export const COUNT_OPTIONS = [1, 2, 4, 9] as const

export const RATIO_OPTIONS = [
  '1:1',
  '1:2',
  '2:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '9:21',
] as const

export { RATIO_FOLLOW_SOURCE }

export const RESOLUTION_CUSTOM = '自定义'
export const CUSTOM_SIZE_SEED = '1024x1024'

export const RESOLUTION_OPTIONS: { value: 'auto' | '1k' | '2k' | '4k'; label: string }[] = [
  { value: 'auto', label: '自适应' },
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]

export const QUALITY_OPTIONS: { value: 'auto' | 'low' | 'medium' | 'high'; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

export const SIZE_OPTIONS: { value: 'auto' | '480p' | '720p' | '1080p'; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
]

export const CATEGORY_OPTIONS: { value: 'image' | 'video'; label: string }[] = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
]

export const DEFAULT_DURATION = 5

export const QUALITY_LABELS: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极致',
}

export const BACKGROUND_LABELS: Record<string, string> = {
  auto: '默认',
  transparent: '透明底',
}

export function resolutionsOf(cap?: ModelCapability): string[] {
  void cap
  return RESOLUTION_OPTIONS.map((option) => option.value)
}

export function ratiosOf(cap?: ModelCapability, withFollowSource = false): string[] {
  void cap
  return withFollowRatio(RATIO_OPTIONS, withFollowSource)
}

export function withFollowRatio(ratios: readonly string[], withFollowSource: boolean): string[] {
  if (!withFollowSource || ratios.includes(RATIO_FOLLOW_SOURCE)) return [...ratios]
  return [...ratios, RATIO_FOLLOW_SOURCE]
}

export function promptNeedsExpand(scrollHeight: number, clientHeight: number): boolean {
  return scrollHeight > clientHeight + 1
}

export function resolutionLabelOf(value: string): string {
  return RESOLUTION_OPTIONS.find((option) => option.value === value)?.label ?? value.toUpperCase()
}

export function qualityLabelOf(value: string): string {
  return QUALITY_LABELS[value] ?? QUALITY_OPTIONS.find((option) => option.value === value)?.label ?? value
}

export function backgroundLabelOf(value: string): string {
  return BACKGROUND_LABELS[value] ?? value
}

export function resolutionValueOf(size: string): string {
  return /^\d+k$/i.test(size) ? size.toLowerCase() : size
}
