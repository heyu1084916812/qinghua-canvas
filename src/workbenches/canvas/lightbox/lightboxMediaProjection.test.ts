import { describe, expect, it } from 'vitest'
import {
  lightboxCompareAvailableOf,
  lightboxCompareSourceOf,
  lightboxMediaProjectionOf,
  type LightboxMediaProjectionInput,
} from './lightboxMediaProjection'

const nodes = [
  { data: { assetHash: 'asset-a', compareWith: 'asset-b' } },
]

function input(overrides: Partial<LightboxMediaProjectionInput> = {}): LightboxMediaProjectionInput {
  return {
    assetHash: 'asset-a',
    url: 'blob:asset-a',
    isVideo: false,
    compareHash: 'asset-b',
    compareUrl: 'blob:asset-b',
    compareIsVideo: false,
    compareKind: 'result',
    compareView: 'first',
    splitRatio: 0.5,
    mode: 'compare',
    rotating: false,
    cropping: false,
    angle: 0,
    mirrorH: false,
    mirrorV: false,
    cropRect: null,
    natural: null,
    viewport: null,
    ...overrides,
  }
}

describe('lightboxMediaProjection', () => {
  it('derives the compare hash and kind from the node snapshot', () => {
    expect(lightboxCompareSourceOf({
      nodes,
      assetHash: 'asset-a',
      compareKind: 'pair',
    })).toEqual({ compareHash: 'asset-b', compareKind: 'pair' })
    expect(lightboxCompareSourceOf({
      nodes,
      assetHash: 'asset-a',
      compareWith: 'explicit',
      compareKind: undefined,
    })).toEqual({ compareHash: 'explicit', compareKind: 'result' })
  })

  it('projects compare availability, hashes and the first media URL', () => {
    const result = lightboxMediaProjectionOf(input())
    expect(result.compareAvailable).toBe(true)
    expect(result.view).toBe('first')
    expect(result.compareLeftHash).toBe('asset-b')
    expect(result.compareRightHash).toBe('asset-a')
    expect(result.primaryUrl).toBe('blob:asset-a')
    expect(result.compareClipPath).toBe('inset(0 50.000% 0 0)')
  })

  it('switches the primary media when the second compare view is active', () => {
    const result = lightboxMediaProjectionOf(input({ compareView: 'second' }))
    expect(result.showSecondOnly).toBe(true)
    expect(result.primaryUrl).toBe('blob:asset-b')
    expect(result.compareAvailable).toBe(true)
  })

  it('disables video comparison and falls back to the first view', () => {
    const result = lightboxMediaProjectionOf(input({ compareIsVideo: true }))
    expect(result.compareAvailable).toBe(false)
    expect(result.view).toBe('first')
    expect(result.primaryUrl).toBe('blob:asset-a')
    expect(lightboxCompareAvailableOf({
      compareHash: 'asset-b',
      compareUrl: 'blob:asset-b',
      isVideo: false,
      compareIsVideo: true,
    })).toBe(false)
  })

  it('projects placed media geometry, rotation transform and crop geometry', () => {
    const result = lightboxMediaProjectionOf(input({
      mode: 'rotate',
      rotating: true,
      angle: 450,
      mirrorH: true,
      natural: { w: 320, h: 240 },
      viewport: { x: 10, y: 20, zoom: 2 },
      cropRect: { x: 10, y: 20, w: 30, h: 40 },
    }))
    expect(result.box).toEqual({ left: -20, top: -40, width: 640, height: 480 })
    expect(result.normalizedAngle).toBe(90)
    expect(result.mediaStyle).toMatchObject({
      ...result.box,
      transformOrigin: '50% 50%',
      transform: 'rotate(450deg) scaleX(-1) scaleY(1)',
    })
    expect(result.cropBox).toEqual({ left: 0, top: 0, width: 60, height: 80 })
  })

  it('requires a visible crop frame with the shared minimum edge', () => {
    expect(lightboxMediaProjectionOf(input({
      cropping: true,
      cropRect: { x: 0, y: 0, w: 31, h: 31 },
    })).canConfirm).toBe(false)
    expect(lightboxMediaProjectionOf(input({
      cropping: true,
      cropRect: { x: 0, y: 0, w: 32, h: 32 },
    })).canConfirm).toBe(true)
  })
})
