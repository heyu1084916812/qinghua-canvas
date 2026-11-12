import { describe, expect, it } from 'vitest'
import {
  researchOverlayReservedRight,
  researchTabDestination,
} from './useResearchOverlay'

describe('researchOverlayReservedRight', () => {
  it('leaves the open Agent column visible beside research overlays', () => {
    expect(researchOverlayReservedRight(1440, { left: 1000, width: 420 })).toBe(440)
    expect(researchOverlayReservedRight(1024, { left: 604, width: 420 })).toBe(420)
  })

  it('uses the full viewport when there is no measured Agent panel', () => {
    expect(researchOverlayReservedRight(1024, null)).toBe(0)
    expect(researchOverlayReservedRight(1024, { left: 0, width: 0 })).toBe(0)
  })
})

describe('researchTabDestination', () => {
  it('wraps keyboard focus inside the active nested dialog', () => {
    expect(researchTabDestination(2, 3, false)).toBe(0)
    expect(researchTabDestination(0, 3, true)).toBe(2)
    expect(researchTabDestination(1, 3, false)).toBeNull()
    expect(researchTabDestination(1, 3, true)).toBeNull()
  })

  it('enters the first or last control when focus is outside the dialog', () => {
    expect(researchTabDestination(-1, 2, false)).toBe(0)
    expect(researchTabDestination(-1, 2, true)).toBe(1)
    expect(researchTabDestination(0, 0, false)).toBeNull()
  })
})
