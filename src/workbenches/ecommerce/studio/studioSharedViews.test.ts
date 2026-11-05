import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  CategoryGlyph,
  OptionCheck,
  OptionContent,
  modelIconFor,
  textOptions,
} from './studioSharedViews'

describe('ecommerce studio shared views', () => {
  it('keeps option text and checkmark DOM anchors', () => {
    const html = renderToStaticMarkup(createElement(OptionContent, {
      option: { id: 'clarity', label: '清晰度', hint: '保留材质' },
    }))
    expect(html).toContain('清晰度')
    expect(html).toContain('data-ecommerce-option-hint')
    expect(renderToStaticMarkup(createElement(OptionCheck, { checked: true }))).toContain('<path')
    expect(renderToStaticMarkup(createElement(OptionCheck, { checked: false }))).not.toContain('<path')
  })

  it('keeps category glyphs and select-option projection', () => {
    expect(renderToStaticMarkup(createElement(CategoryGlyph, { category: 'video' }))).toContain('rect')
    expect(renderToStaticMarkup(createElement(CategoryGlyph, { category: 'wear' }))).toContain('svg')
    expect(renderToStaticMarkup(createElement(CategoryGlyph, { category: 'product' }))).toContain('svg')
    expect(textOptions([{ id: 'a', label: '甲' }])).toEqual([{ value: 'a', label: '甲' }])
  })

  it('does not invent a model icon for an unknown model', () => {
    expect(modelIconFor('不存在的模型 · unknown')).toBeUndefined()
  })
})
