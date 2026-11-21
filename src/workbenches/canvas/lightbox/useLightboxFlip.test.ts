import { describe, expect, it } from 'vitest'
import { rectStyle, sourceNodeIdOf, sourceRectFromFrame } from './useLightboxFlip'

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
