import { describe, expect, it } from 'vitest'
import { boxesOverlap, cutPolylineAt, distanceToPolyline, segmentBox, segmentHitsPolyline, type ScreenPoint } from './edgeCutGeometry'

/** 一条水平直线：y=100，x 从 0 到 300，每 50 一个采样点 */
const line: ScreenPoint[] = [
  { x: 0, y: 100 },
  { x: 50, y: 100 },
  { x: 100, y: 100 },
  { x: 150, y: 100 },
  { x: 200, y: 100 },
  { x: 250, y: 100 },
  { x: 300, y: 100 },
]

describe('edgeCutGeometry · 切断位置（#1159）', () => {
  it('★ 在指针最近的采样点切开，两段首尾相接且不丢点', () => {
    const halves = cutPolylineAt(line, { x: 148, y: 106 })!
    expect(halves.index).toBe(3)
    expect(halves.top).toBe('M0.0 100.0 L50.0 100.0 L100.0 100.0 L150.0 100.0')
    expect(halves.bottom).toBe('M150.0 100.0 L200.0 100.0 L250.0 100.0 L300.0 100.0')
  })

  it('★ 切在端点上也不允许出现"空的一段"（index 夹在 1..n-2）', () => {
    expect(cutPolylineAt(line, { x: 0, y: 100 })!.index).toBe(1)
    expect(cutPolylineAt(line, { x: 300, y: 100 })!.index).toBe(line.length - 2)
  })

  it('点太少（不足 3 点）直接放弃，不产生畸形路径', () => {
    expect(cutPolylineAt([{ x: 0, y: 0 }, { x: 10, y: 10 }], { x: 5, y: 5 })).toBeNull()
  })

  it('距离判定：线上 0、线上 8px 是 8、远离则更大', () => {
    expect(distanceToPolyline(line, { x: 120, y: 100 })).toBe(0)
    expect(distanceToPolyline(line, { x: 120, y: 108 })).toBeCloseTo(8, 5)
    expect(distanceToPolyline(line, { x: 120, y: 200 })).toBeCloseTo(100, 5)
  })
})

describe('edgeCutGeometry · 刀锋扫掠（#1159 第二轮）', () => {
  it('★★ 快速挥刀：两点之间隔很远也能切中（点检测会漏）', () => {
    /* 竖线 x=100，从上到下；刀锋从 (0,150) 一下甩到 (300,150) */
    const line = [
      { x: 100, y: 0 },
      { x: 100, y: 300 },
    ]
    const hit = segmentHitsPolyline(line, { x: 0, y: 150 }, { x: 300, y: 150 })
    expect(hit).not.toBeNull()
    expect(Math.round(hit!.point.x)).toBe(100)
    expect(Math.round(hit!.point.y)).toBe(150)
  })

  it('★ 没穿过就不算命中（切线平行于刀锋）', () => {
    const line = [
      { x: 100, y: 0 },
      { x: 100, y: 300 },
    ]
    expect(segmentHitsPolyline(line, { x: 0, y: 400 }, { x: 300, y: 400 })).toBeNull()
  })

  it('★ 包围盒粗筛：重叠 / 不重叠', () => {
    const a = segmentBox({ x: 0, y: 0 }, { x: 10, y: 10 }, 2)
    expect(boxesOverlap(a, { minX: 5, minY: 5, maxX: 30, maxY: 30 })).toBe(true)
    expect(boxesOverlap(a, { minX: 50, minY: 50, maxX: 60, maxY: 60 })).toBe(false)
  })
})