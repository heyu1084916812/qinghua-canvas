import { describe, expect, it } from 'vitest'
import { nextCanvasDetailMode } from './detailMode'

describe('nextCanvasDetailMode', () => {
  it('keeps real thumbnails at every supported zoom level', () => {
    for (const zoom of [0.1, 0.18, 0.28, 0.5, 1, 5]) {
      expect(nextCanvasDetailMode('full', zoom)).toBe('full')
      expect(nextCanvasDetailMode('coarse', zoom)).toBe('full')
    }
  })
})
