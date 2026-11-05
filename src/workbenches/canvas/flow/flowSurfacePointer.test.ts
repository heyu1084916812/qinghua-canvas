import { describe, expect, it } from 'vitest'
import {
  CLICK_SLOP_PX,
  FLOATING_SELECTORS,
  dragAnchorOf,
  isClickAfterDrag,
  marqueeBetween,
  pointerWorldPoint,
} from './flowSurfacePointer'

const vp = { x: 100, y: 50, zoom: 2 }
const surface = { x: 10, y: 20, w: 800, h: 600 }

describe('FlowSurface 指针与框选几何', () => {
  it('豁免名单包含创作面板、小地图、端点命中和空画布引导', () => {
    for (const selector of [
      '[data-creation-panel]',
      '[data-minimap]',
      '[data-flow-port-hit]',
      '[data-empty-canvas-guide]',
    ]) {
      expect(FLOATING_SELECTORS).toContain(selector)
    }
    expect(FLOATING_SELECTORS.split(', ')).toHaveLength(17)
  })

  it('屏幕坐标按 surface 与 store 视口换算为世界坐标', () => {
    expect(pointerWorldPoint({ clientX: 110, clientY: 120 }, vp, surface)).toEqual({
      x: 150,
      y: 100,
    })
    expect(pointerWorldPoint({ clientX: '110', clientY: 120 }, vp, surface)).toBeNull()
    expect(pointerWorldPoint(null, vp, surface)).toBeNull()
  })

  it('框选矩形保留负宽高的方向信息，拖过阈值不算单击', () => {
    expect(marqueeBetween({ x: 10, y: 20 }, { x: 4, y: 35 })).toEqual({
      x: 10,
      y: 20,
      w: -6,
      h: 15,
    })
    expect(isClickAfterDrag({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false)
    expect(isClickAfterDrag({ x: 10, y: 10 }, { x: 10 + CLICK_SLOP_PX + 0.1, y: 10 })).toBe(true)
  })

  it('拖动起点锚按 DOM 矩形和缩放换算，缺 DOM 的节点不猜坐标', () => {
    const rects = new Map([
      ['a', { x: 110, y: 120 }],
      ['b', { x: 210, y: 220 }],
    ])
    expect(dragAnchorOf(['a', 'b', 'missing'], rects, { left: 10, top: 20 }, vp)).toEqual(
      new Map([
        ['a', { x: 150, y: 100 }],
        ['b', { x: 200, y: 150 }],
      ]),
    )
  })
})
