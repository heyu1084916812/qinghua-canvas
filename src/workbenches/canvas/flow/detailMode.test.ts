import { describe, expect, it } from 'vitest'
import { COARSE_ENTER_ZOOM, COARSE_EXIT_ZOOM, nextCanvasDetailMode } from './detailMode'

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
