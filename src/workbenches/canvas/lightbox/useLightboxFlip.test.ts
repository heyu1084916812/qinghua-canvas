import { describe, expect, it } from 'vitest'
import {
  LIGHTBOX_MOTION,
  lightboxEntryMode,
  lightboxPrimarySource,
  settledMediaRect,
  snapshotRect,
  sourceNodeIdOf,
  sourceRectFromFrame,
} from './lightboxFlipController'
import {
  centerAnchoredFlipTransform,
  rectStyle,
} from './lightboxFlipFrame'
import { predictedMediaRect } from './lightboxViewportMath'

describe('sourceNodeIdOf', () => {
  const nodes = [
    { id: 'a', data: { assetHash: 'same' } },
    { id: 'b', data: { assetHash: 'same' } },
  ]

  it('prefers the clicked node when the asset is reused', () => {
    expect(sourceNodeIdOf(nodes, 'same', 'b')).toBe('b')
  })

  it('falls back to the first matching owner without a source node', () => {
    expect(sourceNodeIdOf(nodes, 'same')).toBe('a')
  })
})

describe('sourceRectFromFrame', () => {
  const rect = (width: number, height: number, left = 0, top = 0) => ({
    width, height, left, top, right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => ({}),
  }) as DOMRect

  it('uses the visible media rectangle instead of the frame shell', () => {
    const image = { getBoundingClientRect: () => rect(360, 240, 30, 40) }
    const frame = { querySelector: () => image, getBoundingClientRect: () => rect(420, 320) }
    expect(sourceRectFromFrame(frame as unknown as HTMLElement)).toMatchObject({ width: 360, height: 240, left: 30, top: 40 })
  })

  it('falls back to the frame when media has not acquired a box yet', () => {
    const image = { getBoundingClientRect: () => rect(0, 0) }
    const frame = { querySelector: () => image, getBoundingClientRect: () => rect(420, 320, 10, 20) }
    expect(sourceRectFromFrame(frame as unknown as HTMLElement)).toMatchObject({ width: 420, height: 320, left: 10, top: 20 })
  })
})

describe('rectStyle', () => {
  it('serializes a viewport rect for a fixed-position FLIP clone', () => {
    expect(rectStyle({ left: 12, top: 34, width: 56, height: 78 })).toEqual({
      left: '12px', top: '34px', width: '56px', height: '78px',
    })
  })
})

describe('centerAnchoredFlipTransform', () => {
  it('maps a source rect onto the target around their shared center', () => {
    expect(
      centerAnchoredFlipTransform(
        { left: 10, top: 20, width: 100, height: 50 },
        { left: 200, top: 100, width: 300, height: 150 },
      ),
    ).toBe('translate(-290px, -130px) scale(0.3333333333333333, 0.3333333333333333)')
  })
})

describe('snapshotRect', () => {
  it('copies DOMRect prototype geometry into a plain snapshot', () => {
    const liveRect = {
      left: 12,
      top: 34,
      width: 56,
      height: 78,
      get right() { return 68 },
      get bottom() { return 112 },
      toJSON: () => ({}),
    } as DOMRect
    expect(snapshotRect(liveRect)).toMatchObject({
      left: 12,
      top: 34,
      width: 56,
      height: 78,
      right: 68,
      bottom: 112,
    })
  })
})

describe('lightboxPrimarySource', () => {
  it('uses the already-decoded source image while the full asset is loading', () => {
    expect(
      lightboxPrimarySource({
        fullUrl: null,
        sourceSrc: 'blob:thumbnail',
        sourceKind: 'image',
        mime: null,
      }),
    ).toBe('blob:thumbnail')
  })

  it('never renders a video thumbnail as an image fallback', () => {
    expect(
      lightboxPrimarySource({
        fullUrl: null,
        sourceSrc: 'blob:poster',
        sourceKind: 'video',
        mime: 'video/mp4',
      }),
    ).toBeNull()
  })

  it('prefers the full asset as soon as it is available', () => {
    expect(
      lightboxPrimarySource({
        fullUrl: 'blob:full',
        sourceSrc: 'blob:thumbnail',
        sourceKind: 'image',
        mime: 'image/png',
      }),
    ).toBe('blob:full')
  })

  it('steps thumbnail → decoded preview → original', () => {
    const base = { sourceSrc: 'http://s/thumb/a', sourceKind: 'image' as const, mime: 'image/png' }
    expect(lightboxPrimarySource({ ...base, fullUrl: null, previewUrl: null })).toBe('http://s/thumb/a')
    expect(lightboxPrimarySource({ ...base, fullUrl: null, previewUrl: 'http://s/preview/a' })).toBe('http://s/preview/a')
    expect(lightboxPrimarySource({ ...base, fullUrl: 'http://s/asset/a', previewUrl: 'http://s/preview/a' })).toBe('http://s/asset/a')
  })
})

describe('settledMediaRect', () => {
  it('waits until the lightbox media has its final inline box', () => {
    const target = {
      style: { width: '', height: '' },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 2, height: 2 }) as DOMRect,
    }
    expect(settledMediaRect(target as unknown as HTMLElement)).toBeNull()
  })

  it('returns the settled lightbox box after layout', () => {
    const target = {
      style: { width: '720px', height: '480px' },
      getBoundingClientRect: () => ({
        left: 360,
        top: 210,
        width: 720,
        height: 480,
      }) as DOMRect,
    }
    expect(settledMediaRect(target as unknown as HTMLElement)).toMatchObject({
      left: 360,
      top: 210,
      width: 720,
      height: 480,
    })
  })
})

describe('predictedMediaRect', () => {
  it('computes the target box before the original asset finishes decoding', () => {
    const stage = {
      getBoundingClientRect: () => ({
        left: 64,
        top: 33,
        width: 1376,
        height: 810,
      }) as DOMRect,
    }
    const rect = predictedMediaRect(stage as unknown as HTMLElement, { w: 720, h: 480 })
    expect(rect).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
    expect(rect!.width).toBeGreaterThan(100)
    expect(rect!.height).toBeGreaterThan(100)
  })
})

describe('lightbox motion contract', () => {
  it('runs entry FLIP only for a newly opened asset, not gallery switches', () => {
    expect(lightboxEntryMode(undefined, 'a')).toBe('enter')
    expect(lightboxEntryMode('a', 'b')).toBe('switch')
    expect(lightboxEntryMode('b', 'b')).toBe('none')
    expect(lightboxEntryMode('a', undefined)).toBe('none')
  })

  it('fades the overlay for the same duration on enter and exit', () => {
    expect(LIGHTBOX_MOTION.overlayMs).toBe(360)
  })

  it('keeps the exit slightly faster than the entrance', () => {
    expect(LIGHTBOX_MOTION.exitMs).toBeLessThan(LIGHTBOX_MOTION.enterMs)
  })
})
