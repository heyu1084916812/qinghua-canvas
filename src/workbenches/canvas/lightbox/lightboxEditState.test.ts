import { describe, expect, it } from 'vitest'
import {
  compareClipPathOf,
  compareViewOf,
  compareViewsOf,
  redoAnnotation,
  splitRatioAt,
  undoAnnotation,
} from './lightboxEditState'

describe('Lightbox 编辑状态规则', () => {
  it('只有进入对比模式且配对可用时才切到分屏 / 第二张', () => {
    expect(compareViewOf('view', true, 'split')).toBe('first')
    expect(compareViewOf('compare', false, 'second')).toBe('first')
    expect(compareViewOf('compare', true, 'second')).toBe('second')
  })

  it('pair 与 result 两种对比方向分别用互补裁剪路径', () => {
    expect(compareViewsOf('pair').map((item) => item.label)).toEqual(['A · 左', '对比', 'B · 右'])
    expect(compareViewsOf('result').map((item) => item.label)).toEqual(['结果', '对比', '原图'])
    expect(compareClipPathOf('pair', 0.25)).toBe('inset(0 0 0 25.000%)')
    expect(compareClipPathOf('result', 0.25)).toBe('inset(0 75.000% 0 0)')
  })

  it('分割线夹在 5%–95%，无媒体框时保留当前比例', () => {
    const box = { left: 50, top: 0, width: 200, height: 100 }
    expect(splitRatioAt(250, { x: 0 }, box, 0.5)).toBe(0.95)
    expect(splitRatioAt(10, { x: 0 }, box, 0.5)).toBe(0.05)
    expect(splitRatioAt(150, { x: 0 }, box, 0.5)).toBe(0.5)
    expect(splitRatioAt(150, { x: 0 }, undefined, 0.42)).toBe(0.42)
  })

  it('标注撤销 / 重做只移动一笔，空栈不伪造操作', () => {
    const undone = undoAnnotation([1, 2, 3])
    expect(undone).toEqual({ ops: [1, 2], undone: [3] })
    expect(undoAnnotation([])).toEqual({ ops: [], undone: [] })
    expect(redoAnnotation([1, 2], [3, 4])).toEqual({ ops: [1, 2, 3], undone: [4] })
    expect(redoAnnotation([1], [])).toEqual({ ops: [1], undone: [] })
  })
})
