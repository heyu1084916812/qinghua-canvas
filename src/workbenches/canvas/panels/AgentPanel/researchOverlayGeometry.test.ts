import { describe, expect, it } from 'vitest'
import { researchOverlayBounds } from './researchOverlayGeometry'

describe('researchOverlayBounds', () => {
  it('uses the real canvas surface instead of the whole viewport', () => {
    expect(
      researchOverlayBounds(1440, 900, {
        left: 64,
        top: 33,
        right: 1020,
        bottom: 885,
      }),
    ).toEqual({ left: 64, top: 33, right: 420, bottom: 15 })
  })

  it('keeps the Agent column visible at the minimum desktop width', () => {
    expect(
      researchOverlayBounds(1024, 700, {
        left: 64,
        top: 33,
        right: 588,
        bottom: 685,
      }),
    ).toEqual({ left: 64, top: 33, right: 436, bottom: 15 })
  })

  it('falls back to the full viewport when no canvas surface exists', () => {
    expect(researchOverlayBounds(1024, 700, null)).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    })
    expect(
      researchOverlayBounds(1024, 700, {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      }),
    ).toEqual({ left: 0, top: 0, right: 0, bottom: 0 })
  })
})
