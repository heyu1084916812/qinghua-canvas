import { describe, expect, it } from 'vitest'
import { isKnownClipperPlaceholderImageUrl } from './clipperPlaceholder'

describe('clipper placeholder rules', () => {
  it('rejects Huaban site-share assets without rejecting real remote images', () => {
    expect(isKnownClipperPlaceholderImageUrl(
      'https://cdn.dancf.com/fe-assets/img/default-smiley.png',
    )).toBe(true)
    expect(isKnownClipperPlaceholderImageUrl(
      'https://gd-hbimg.huaban.com/real-original.webp',
    )).toBe(false)
    expect(isKnownClipperPlaceholderImageUrl('not a url')).toBe(false)
  })
})
