import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  lightboxSourceRectFromMedia,
  lightboxSourceRectForThumbnail,
} from './lightboxSourceRect'

function media(kind: 'image' | 'video', rect: Partial<DOMRect>) {
  return {
    tagName: kind === 'video' ? 'VIDEO' : 'IMG',
    currentSrc: kind === 'image' ? 'blob:image' : '',
    src: kind === 'image' ? 'blob:image' : '',
    getAttribute: () => (kind === 'video' ? 'blob:video' : null),
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width: 320,
      height: 180,
      right: 330,
      bottom: 200,
      x: 10,
      y: 20,
      toJSON: () => ({}),
      ...rect,
    }),
  } as unknown as HTMLElement
}

describe('lightbox source rect', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the same hash, kind and source for both lightbox entry paths', () => {
    expect(lightboxSourceRectFromMedia(media('image', {}), 'asset-a', '12px')).toMatchObject({
      left: 10,
      top: 20,
      width: 320,
      height: 180,
      borderRadius: '12px',
      src: 'blob:image',
      kind: 'image',
      assetHash: 'asset-a',
    })
    expect(lightboxSourceRectFromMedia(media('video', {}), 'asset-v', '8px')).toMatchObject({
      src: 'blob:video',
      kind: 'video',
      assetHash: 'asset-v',
    })
  })

  it('ignores zero-size frames', () => {
    expect(
      lightboxSourceRectFromMedia(media('image', { width: 0 }), 'asset-a', '12px'),
    ).toBeUndefined()
  })

  it('uses the image inside a thumbnail button as the FLIP source', () => {
    const image = media('image', {})
    const host = {
      matches: () => false,
      querySelector: () => image,
    } as unknown as HTMLElement
    vi.stubGlobal('getComputedStyle', () => ({ borderRadius: '10px' }))

    expect(lightboxSourceRectForThumbnail(host, 'asset-thumb')).toMatchObject({
      left: 10,
      top: 20,
      width: 320,
      height: 180,
      borderRadius: '10px',
      src: 'blob:image',
      kind: 'image',
      assetHash: 'asset-thumb',
    })
  })
})
