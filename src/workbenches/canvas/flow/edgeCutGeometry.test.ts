import { describe, expect, it } from 'vitest'
import { cutPolylineAt, distanceToPolyline, type ScreenPoint } from './edgeCutGeometry'

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
