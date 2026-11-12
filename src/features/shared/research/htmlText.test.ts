import { describe, expect, it } from 'vitest'
import { clipText, decodeHtmlEntities, inlineTextOf, parseTagAttributes } from './htmlText'

describe('htmlText', () => {
  it('decodes named and numeric entities and keeps unknown ones', () => {
    expect(decodeHtmlEntities('a &amp; b &#183; &#x4E2D; &nbsp;&hellip; &bogus; &')).toBe(
      'a & b · 中  … &bogus; &',
    )
    expect(decodeHtmlEntities('&#0;&#x110000;')).toBe('&#0;&#x110000;')
  })

  it('flattens markup, scripts and comments into one line of text', () => {
    expect(inlineTextOf('<b>Tea</b>\n<script>x()</script><!-- c --> &amp; <i>Coffee</i>')).toBe(
      'Tea & Coffee',
    )
    expect(inlineTextOf('<strong>咖啡</strong>网 - 中国<b>咖啡</b><br>产业')).toBe('咖啡网 - 中国咖啡 产业')
  })

  it('parses double, single and bare attribute values, lower-casing names', () => {
    expect(parseTagAttributes(` HREF="/a?x=1&amp;y=2" m='{"t":"q"}' data-x=bare disabled`)).toEqual({
      href: '/a?x=1&y=2',
      m: '{"t":"q"}',
      'data-x': 'bare',
      disabled: '',
    })
  })

  it('clips with an ellipsis only when needed', () => {
    expect(clipText('  short  text ', 20)).toBe('short text')
    expect(clipText('abcdefghij', 5)).toBe('abcd…')
  })
})
