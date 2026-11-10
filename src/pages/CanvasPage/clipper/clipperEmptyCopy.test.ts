import { describe, expect, it } from 'vitest'
import { CLIPPER_UNCATEGORIZED } from '../../../domain/inspiration/clipper'
import { clipperEmptyDescription, clipperEmptyTitle } from './clipperEmptyCopy'

describe('clipper empty copy', () => {
  it('distinguishes all, uncategorized and named categories', () => {
    expect(clipperEmptyTitle(null)).toBe('开始收集灵感吧')
    expect(clipperEmptyDescription(null)).toContain('拖到页面中央')
    expect(clipperEmptyTitle(CLIPPER_UNCATEGORIZED)).toBe('没有未分类的图片')
    expect(clipperEmptyDescription(CLIPPER_UNCATEGORIZED)).toContain('切换到“全部”')
    expect(clipperEmptyTitle('美工部')).toBe('“美工部”还没有图片')
    expect(clipperEmptyDescription('美工部')).toContain('批量转到这个分类')
  })
})
