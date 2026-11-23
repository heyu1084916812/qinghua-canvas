import { describe, expect, it } from 'vitest'
import { sameFlowSnapHints } from './flowSnapHints'

describe('flow snap hint equality', () => {
  it('suppresses identical per-frame hint objects', () => {
    const left = {
      guides: [{ axis: 'x' as const, at: 100, from: 0, to: 80 }],
      gaps: [{ axis: 'x' as const, value: 24, x: 50, y: 20 }],
    }
    expect(sameFlowSnapHints(left, structuredClone(left))).toBe(true)
  })

  it('keeps real guide or gap changes visible', () => {
    const left = { guides: [], gaps: [] }
    expect(
      sameFlowSnapHints(left, {
        guides: [{ axis: 'x', at: 100, from: 0, to: 80 }],
        gaps: [],
      }),
    ).toBe(false)
    expect(
      sameFlowSnapHints(left, {
        guides: [],
        gaps: [{ axis: 'y', value: 12, x: 10, y: 20 }],
      }),
    ).toBe(false)
  })
})
