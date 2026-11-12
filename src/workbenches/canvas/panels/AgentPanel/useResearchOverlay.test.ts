import { describe, expect, it } from 'vitest'
import { researchTabDestination } from './useResearchOverlay'

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
