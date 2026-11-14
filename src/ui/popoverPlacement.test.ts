/**
 * 浮层「朝哪边弹 / 要不要横着挪」的单测（用户 2026-11-14）。
 *
 * 钉住三件事，每一件都对应一次**真实看到的坏样子**：
 *  ① 装不下就往下弹 —— 否则浮层越过容器上沿，进标题排底下（`batch:2` 点不到）；
 *  ② 下方也装不下时不要乱翻 —— 宁可照旧朝上，也不能两头落空；
 *  ③ 贴着可视边界时浮层要收进来 —— 否则最左/最右一列点不到。
 *
 * 尺寸取实测值：循环节点 240 宽、控件 67 宽、浮层 172×111（1440×900 / zoom=1）。
 */
import { describe, it, expect } from 'vitest'
import {
  placePopover,
  shiftIntoBounds,
  POPOVER_EDGE,
  POPOVER_GAP,
} from './popoverPlacement'

const anchorAt = (left: number, top: number, width = 67, height = 30) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})

const POPOVER = { width: 172, height: 111 }
const BOUNDS = { left: 240, top: 15, right: 1425, bottom: 885 }

describe('shiftIntoBounds', () => {
  it('放得下就一动不动', () => {
    expect(shiftIntoBounds({ left: 700, right: 872 }, { left: 240, right: 1425 })).toBe(0)
  })

  it(`★ 越过左缘 → 往右推回，且正好留出 ${POPOVER_EDGE}px`, () => {
    expect(shiftIntoBounds({ left: 160, right: 332 }, { left: 240, right: 1425 })).toBe(
      240 + POPOVER_EDGE - 160,
    )
  })

  it('★ 越过右缘 → 往左推回', () => {
    expect(shiftIntoBounds({ left: 1400, right: 1572 }, { left: 240, right: 1425 })).toBe(
      1425 - POPOVER_EDGE - 1572,
    )
  })

  it('比边界还宽时贴左（与阅读起点对齐），不来回抖', () => {
    expect(shiftIntoBounds({ left: 0, right: 900 }, { left: 240, right: 800 })).toBe(
      240 + POPOVER_EDGE - 0,
    )
  })
})

describe('placePopover', () => {
  it('常规节点（上方够高）→ 朝上，且不横移', () => {
    const p = placePopover(
      {
        anchor: anchorAt(638, 483),
        ceiling: { left: 625, top: 260, right: 865, bottom: 561 },
        bounds: BOUNDS,
        popover: POPOVER,
      },
      1,
    )
    expect(p).toEqual({ below: false, shiftX: 0 })
  })

  it('★ 最短节点（上方只剩 86px 装不下 111）→ 改为朝下弹', () => {
    const p = placePopover(
      {
        anchor: anchorAt(638, 346),
        /** 两个通道都关：节点只有 164 高 */
        ceiling: { left: 625, top: 260, right: 865, bottom: 424 },
        bounds: BOUNDS,
        popover: POPOVER,
      },
      1,
    )
    expect(p.below).toBe(true)
  })

  it('★ 上方装不下、下方也装不下 → 不乱翻，仍朝上（否则两头都看不见）', () => {
    const p = placePopover(
      {
        anchor: anchorAt(638, 346),
        ceiling: { left: 625, top: 260, right: 865, bottom: 424 },
        /** 可视边界下沿就在控件下方 40px 处 */
        bounds: { left: 240, top: 15, right: 1425, bottom: 416 },
        popover: POPOVER,
      },
      1,
    )
    expect(p.below).toBe(false)
  })

  it('★ 贴着可视边界最左缘 → 横移量把浮层推进来（世界坐标，除以缩放）', () => {
    const p = placePopover(
      {
        anchor: anchorAt(280, 483),
        ceiling: { left: 267, top: 260, right: 507, bottom: 561 },
        bounds: BOUNDS,
        popover: POPOVER,
      },
      1,
    )
    /** 浮层原本左缘 = 280 + 33.5 - 86 = 227.5（越界）→ 推到 248 */
    expect(p.below).toBe(false)
    expect(p.shiftX).toBeCloseTo(248 - 227.5, 5)
  })

  it('★ 缩放 0.5 时横移量按世界坐标换算（屏幕位移 ÷ 缩放）', () => {
    const zoom = 0.5
    const p = placePopover(
      {
        /** 缩放后按钮只有 33.5 屏宽、浮层 86×55.5 —— 一律按屏幕像素给 */
        anchor: anchorAt(250, 600, 33.5, 15),
        ceiling: { left: 240, top: 450, right: 360, bottom: 600 },
        bounds: BOUNDS,
        popover: { width: 86, height: 55.5 },
      },
      zoom,
    )
    const left = 250 + 33.5 / 2 - 86 / 2
    const expectedScreen = 240 + POPOVER_EDGE - left
    expect(expectedScreen).toBeGreaterThan(0)
    expect(p.shiftX).toBeCloseTo(expectedScreen / zoom, 5)
  })

  it('缩放非法（0 / 负数）不产生 Infinity —— 退回 1 倍', () => {
    const p = placePopover(
      {
        anchor: anchorAt(638, 483),
        ceiling: { left: 625, top: 260, right: 865, bottom: 561 },
        bounds: BOUNDS,
        popover: POPOVER,
      },
      0,
    )
    expect(Number.isFinite(p.shiftX)).toBe(true)
    expect(p.below).toBe(false)
  })

  it('GAP 常量与 CSS 的 4px 成对（改了这里必须改 .numPopover）', () => {
    expect(POPOVER_GAP).toBe(4)
  })
})
