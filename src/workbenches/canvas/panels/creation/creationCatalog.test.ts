import { describe, expect, it } from 'vitest'
import {
  CATEGORY_OPTIONS,
  COUNT_OPTIONS,
  QUALITY_OPTIONS,
  RATIO_FOLLOW_SOURCE,
  RATIO_OPTIONS,
  RESOLUTION_CUSTOM,
  RESOLUTION_OPTIONS,
  SIZE_OPTIONS,
  backgroundLabelOf,
  promptNeedsExpand,
  qualityLabelOf,
  ratiosOf,
  resolutionLabelOf,
  resolutionValueOf,
  resolutionsOf,
  withFollowRatio,
} from './creationCatalog'

describe('CreationPanel 档位目录', () => {
  it('固定档位集合与公共常量保持兼容', () => {
    expect(COUNT_OPTIONS).toEqual([1, 2, 4, 9])
    expect(RATIO_OPTIONS).toHaveLength(13)
    expect(RATIO_OPTIONS).toContain('21:9')
    expect(RESOLUTION_OPTIONS.map((option) => option.value)).toEqual(['auto', '1k', '2k', '4k'])
    expect(QUALITY_OPTIONS.map((option) => option.value)).toEqual(['auto', 'low', 'medium', 'high'])
    expect(SIZE_OPTIONS.map((option) => option.value)).toEqual(['auto', '480p', '720p', '1080p'])
    expect(CATEGORY_OPTIONS.map((option) => option.value)).toEqual(['image', 'video'])
    expect(RESOLUTION_CUSTOM).toBe('自定义')
  })

  it('比例与画质不被残缺能力表裁剪', () => {
    expect(ratiosOf({ id: 'x', category: 'image' } as never)).toEqual([...RATIO_OPTIONS])
    expect(resolutionsOf({ id: 'x', category: 'image' } as never)).toEqual([
      'auto',
      '1k',
      '2k',
      '4k',
    ])
  })

  it('跟随素材只按是否存在参考图追加一次', () => {
    expect(ratiosOf(undefined, true).at(-1)).toBe(RATIO_FOLLOW_SOURCE)
    expect(withFollowRatio(['1:1', RATIO_FOLLOW_SOURCE], true)).toEqual([
      '1:1',
      RATIO_FOLLOW_SOURCE,
    ])
    expect(withFollowRatio(['1:1'], false)).toEqual(['1:1'])
  })

  it('文案表保留旧值与未知值的原样回退', () => {
    expect(resolutionLabelOf('1k')).toBe('1K')
    expect(qualityLabelOf('xhigh')).toBe('超高')
    expect(backgroundLabelOf('transparent')).toBe('透明底')
    expect(qualityLabelOf('unknown')).toBe('unknown')
    expect(resolutionValueOf('2K')).toBe('2k')
    expect(resolutionValueOf('1024x1024')).toBe('1024x1024')
  })

  it('只有超过一行才开放提示词展开', () => {
    expect(promptNeedsExpand(100, 100)).toBe(false)
    expect(promptNeedsExpand(102, 100)).toBe(true)
  })
})
