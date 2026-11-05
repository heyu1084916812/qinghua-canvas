import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODE_FORM_STATE,
  STUDIO_CATEGORIES,
  STUDIO_MODES,
} from './studioContracts'

describe('ecommerce studio contract', () => {
  it('keeps the visible category order and all twelve generation modes', () => {
    expect(STUDIO_CATEGORIES.map((item) => item.id)).toEqual(['product', 'video', 'wear'])
    expect(STUDIO_MODES.map((item) => item.id)).toEqual([
      'product-set', 'product-detail', 'product-recreate', 'product-white',
      'product-retouch', 'product-recolor', 'video-recreate', 'video-commerce',
      'wear-set', 'wear-model', 'wear-tryon', 'wear-detail',
    ])
  })

  it('keeps the default ratio and common form values stable', () => {
    expect(DEFAULT_MODE_FORM_STATE(STUDIO_MODES[0])).toEqual({
      platformId: 'amazon',
      language: 'en',
      ratio: 'smart',
      resolution: 'auto',
      quality: 'auto',
      note: '',
    })
    expect(DEFAULT_MODE_FORM_STATE(STUDIO_MODES[1]).ratio).toBe('aplus-premium-web')
    expect(DEFAULT_MODE_FORM_STATE(STUDIO_MODES[3]).ratio).toBe('1:1')
  })
})
