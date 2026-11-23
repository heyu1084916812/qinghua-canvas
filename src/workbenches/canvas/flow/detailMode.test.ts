import { describe, expect, it } from 'vitest'
import {
  COARSE_ENTER_ZOOM,
  COARSE_EXIT_ZOOM,
  nextCanvasDetailMode,
  shouldCoarsenGestureNodes,
} from './detailMode'

describe('nextCanvasDetailMode', () => {
  it('enters coarse mode only below the low zoom boundary', () => {
    expect(nextCanvasDetailMode('full', COARSE_ENTER_ZOOM - 0.001)).toBe('coarse')
    expect(nextCanvasDetailMode('full', COARSE_ENTER_ZOOM)).toBe('full')
  })

  it('uses hysteresis so zooming near the boundary does not thrash', () => {
    expect(nextCanvasDetailMode('coarse', COARSE_ENTER_ZOOM + 0.02)).toBe('coarse')
    expect(nextCanvasDetailMode('coarse', COARSE_EXIT_ZOOM + 0.001)).toBe('full')
  })
})

describe('shouldCoarsenGestureNodes', () => {
  it('coarsens only dense full-detail gestures', () => {
    expect(
      shouldCoarsenGestureNodes({
        moving: true,
        detailMode: 'full',
        renderedNodeCount: 300,
      }),
    ).toBe(true)
    expect(
      shouldCoarsenGestureNodes({
        moving: true,
        detailMode: 'full',
        renderedNodeCount: 40,
      }),
    ).toBe(false)
    expect(
      shouldCoarsenGestureNodes({
        moving: false,
        detailMode: 'full',
        renderedNodeCount: 300,
      }),
    ).toBe(false)
  })
})
