import { describe, expect, it } from 'vitest'
import {
  DRAG_SLOP,
  FIT_PADDING,
  WHEEL_STEP,
  cropBoxOf,
  dragPan,
  fitMediaViewport,
  gallerySwitchViewport,
  imagePointAt,
  mediaBoxOf,
  wheelZoom,
} from './lightboxViewportMath'

const viewport = { x: 10, y: 20, zoom: 2 }
const stage = { x: 0, y: 0, w: 800, h: 600 }

describe('Lightbox 缩放平移数学', () => {
  it('保留画布同款 fit 余量、滚轮倍率与拖过阈值', () => {
    expect(FIT_PADDING).toBe(112)
    expect(WHEEL_STEP).toBe(1.12)
    expect(DRAG_SLOP).toBe(3)
  })

  it('滚轮按指针锚点缩放，平移按指针位移改视口', () => {
    const zoomed = wheelZoom(viewport, -1, 100, 100, stage)
    expect(zoomed.zoom).toBeCloseTo(2 * 1.12)
    expect(dragPan(viewport, 5, -3)).toEqual({ x: 7.5, y: 21.5, zoom: 2 } as never)
  })

  it('媒体框与选区框共用同一个 vp → 屏幕换算', () => {
    expect(mediaBoxOf({ w: 320, h: 240 }, viewport)).toEqual({
      left: -20,
      top: -40,
      width: 640,
      height: 480,
    })
    expect(cropBoxOf({ x: 10, y: 20, w: 30, h: 40 }, viewport)).toEqual({
      left: 0,
      top: 0,
      width: 60,
      height: 80,
    })
    expect(cropBoxOf(null, viewport)).toBeUndefined()
  })

  it('图片坐标夹在自然尺寸内，初次适配仍使用 fitViewport', () => {
    expect(imagePointAt(100, 120, { w: 320, h: 240 }, viewport, stage)).toEqual({ x: 60, y: 80 })
    expect(imagePointAt(100, 120, null, viewport, stage)).toBeNull()
    const fitted = fitMediaViewport({ w: 320, h: 240 }, stage)
    expect(fitted.zoom).toBeGreaterThan(0)
  })

  it('切换不同尺寸媒体时保持中心与缩放不变', () => {
    const previous = { w: 640, h: 480 }
    const next = { w: 1280, h: 720 }
    const shifted = gallerySwitchViewport(previous, next, viewport, stage)

    expect(shifted).toEqual({ x: 330, y: 140, zoom: 2 })
    expect((next.w / 2 - shifted!.x) * shifted!.zoom).toBeCloseTo(
      (previous.w / 2 - viewport.x) * viewport.zoom,
    )
    expect((next.h / 2 - shifted!.y) * shifted!.zoom).toBeCloseTo(
      (previous.h / 2 - viewport.y) * viewport.zoom,
    )
  })

  it('未手动缩放时每个画廊媒体按自身尺寸重新适配', () => {
    const previous = { w: 1672, h: 941 }
    const next = { w: 1086, h: 1448 }
    const previousFit = fitMediaViewport(previous, stage)

    expect(gallerySwitchViewport(previous, next, previousFit, stage)).toEqual(
      fitMediaViewport(next, stage),
    )
  })

  it('切图视口纯函数覆盖新灯箱落位、自动 fit 与保持中心', () => {
    const previous = { w: 640, h: 480 }
    const next = { w: 1280, h: 720 }

    expect(gallerySwitchViewport(previous, next, null, stage)).toEqual(
      fitMediaViewport(next, stage),
    )
    expect(gallerySwitchViewport(previous, next, null, null)).toBeNull()
    expect(gallerySwitchViewport(null, next, viewport, stage)).toBeNull()
    expect(gallerySwitchViewport(previous, previous, viewport, stage)).toBeNull()
    expect(gallerySwitchViewport(previous, next, viewport, null)).toEqual({
      x: 330,
      y: 140,
      zoom: 2,
    })
  })
})
