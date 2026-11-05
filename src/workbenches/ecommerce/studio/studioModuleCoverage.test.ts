import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODE_FORM_STATE,
  STUDIO_MODES,
} from './studioContracts'
import { GenerationStageView, ResultStatusOverlay } from './EcommerceStudioStatusViews'
import { ModeSpecificParameters } from './EcommerceStudioModeParameters'
import { ProductModeParameters } from './EcommerceStudioModeParametersProduct'
import { MediaAndWearModeParameters } from './EcommerceStudioModeParametersMedia'
import { PersonSettings } from './EcommerceStudioPersonSettings'
import { CategoryGlyph, modelIconFor } from './studioSharedViews'

const SOURCES = import.meta.glob(
  './*.{ts,tsx,module.css}',
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, unknown>

const countLines = (source: string) =>
  source.endsWith('\n') ? source.split('\n').length - 1 : source.split('\n').length

describe('ecommerce studio module coverage', () => {
  it('keeps every new TS/TSX and CSS module within its budget', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      const text = typeof source === 'string' ? source : ''
      if (path.endsWith('.test.ts') || !path.includes('EcommerceStudio') && !path.includes('studio')) continue
      expect(text, `${path} missing`).toBeTypeOf('string')
      expect(countLines(text), `${path} over budget`).toBeLessThanOrEqual(
        path.endsWith('.css') ? 600 : 450,
      )
    }
  })

  it('exports the mode, status, parameter, person and shared-view assembly points', () => {
    expect(STUDIO_MODES.length).toBe(12)
    expect(DEFAULT_MODE_FORM_STATE(STUDIO_MODES[0]).ratio).toBe('smart')
    for (const entry of [
      GenerationStageView, ResultStatusOverlay, ModeSpecificParameters,
      ProductModeParameters, MediaAndWearModeParameters, PersonSettings,
      CategoryGlyph, modelIconFor,
    ]) expect(entry).toBeTypeOf('function')
  })
})
