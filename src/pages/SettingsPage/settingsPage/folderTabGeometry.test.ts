import { describe, expect, it } from 'vitest'
import {
  TAB_ACTIVE_HEIGHT,
  TAB_HEADER_HEIGHT,
  inactiveTabPath,
  isSpringSettled,
  morphingTabPath,
  stepSpring,
} from './folderTabGeometry'

describe('folderTabGeometry（文件夹标签几何）', () => {
  it('第一枚标签左边是竖边（和卡片左上直角对齐），其余左边带斜边', () => {
    const first = inactiveTabPath(120, 40, true)
    const other = inactiveTabPath(120, 40, false)
    expect(first.startsWith('M 0,40 L 0,12')).toBe(true)
    expect(other.startsWith('M 0,40 Q ')).toBe(true)
    expect(first.endsWith('Z')).toBe(true)
    expect(other).toContain('Q')
  })

  it('标签宽度有下限：太窄也至少按 56 画，避免斜边挤成一条线', () => {
    expect(inactiveTabPath(10, 40, true)).toBe(inactiveTabPath(56, 40, true))
  })

  it('选中标签贴在最左时，左侧自动变成竖边（和卡片无缝）', () => {
    const atLeft = morphingTabPath({ x: 0, w: 120, h: TAB_ACTIVE_HEIGHT, vx: 0 })
    expect(atLeft.startsWith(`M 0,${TAB_HEADER_HEIGHT} L 0,`)).toBe(true)
  })

  it('选中标签滑到中间时，左侧带斜边和小圆角，并向左多让出 12px', () => {
    const middle = morphingTabPath({ x: 200, w: 120, h: TAB_ACTIVE_HEIGHT, vx: 0 })
    /* 保留用户要求的左扩轮廓；居中另由真实浏览器的文字中线交点断言验证。 */
    expect(middle.startsWith('M 188,46 Q ')).toBe(true)
  })

  it('水平速度带来顶部倾斜，但限幅在 ±6.5px', () => {
    const fast = morphingTabPath({ x: 0, w: 120, h: TAB_ACTIVE_HEIGHT, vx: 100000 })
    const slow = morphingTabPath({ x: 0, w: 120, h: TAB_ACTIVE_HEIGHT, vx: -100000 })
    const topOf = (path: string) => Number(path.match(/Q ([\d.-]+),([\d.-]+) /)?.[1])
    expect(Math.abs(topOf(fast) - topOf(slow))).toBeLessThanOrEqual(13.1)
  })

  it('弹簧从 0 收敛到目标并带一点过冲', () => {
    let spring = { value: 0, velocity: 0 }
    let peak = 0
    for (let i = 0; i < 240; i += 1) {
      spring = stepSpring(spring, 100, 1 / 60, 340, 22)
      peak = Math.max(peak, spring.value)
    }
    expect(Math.abs(spring.value - 100)).toBeLessThan(0.5)
    expect(peak).toBeGreaterThan(100)
    expect(isSpringSettled(spring, 100)).toBe(true)
  })
})
