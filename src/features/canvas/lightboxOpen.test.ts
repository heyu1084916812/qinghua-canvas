// @ts-expect-error -- tests read source without adding Node types to the app
import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  openNodeLightbox,
  openThumbnailLightbox,
} from './lightboxOpen'

function media(kind: 'image' | 'video' = 'image') {
  return {
    tagName: kind === 'video' ? 'VIDEO' : 'IMG',
    matches: () => true,
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
    }),
  } as unknown as HTMLElement
}

describe('lightbox open adapters', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('node adapter owns sourceRect and sourceNodeId', () => {
    vi.stubGlobal('getComputedStyle', () => ({ borderRadius: '12px' }))
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    const root = {
      querySelector: () => media(),
    } as unknown as ParentNode
    const openLightbox = vi.fn()
    vi.stubGlobal('document', root)

    openNodeLightbox(
      { openLightbox },
      'node-a',
      'hash-a',
      { compareWith: 'other', compareKind: 'pair' },
    )

    expect(openLightbox).toHaveBeenCalledWith('hash-a', {
      compareWith: 'other',
      compareKind: 'pair',
      sourceNodeId: 'node-a',
      sourceRect: {
        left: 10,
        top: 20,
        width: 320,
        height: 180,
        borderRadius: '12px',
        src: 'blob:image',
        kind: 'image',
        assetHash: 'hash-a',
      },
    })
  })

  it('thumbnail adapter owns the image lookup inside its hit target', () => {
    vi.stubGlobal('getComputedStyle', () => ({ borderRadius: '8px' }))
    const host = {
      matches: () => false,
      querySelector: () => media('video'),
    } as unknown as HTMLElement
    const openLightbox = vi.fn()

    openThumbnailLightbox({ openLightbox }, host, 'hash-thumb')

    expect(openLightbox).toHaveBeenCalledWith('hash-thumb', {
      sourceRect: {
        left: 10,
        top: 20,
        width: 320,
        height: 180,
        borderRadius: '8px',
        src: 'blob:video',
        kind: 'video',
        assetHash: 'hash-thumb',
      },
    })
  })

  it('production callers cannot bypass the two adapters', () => {
    const root = new URL('../../', import.meta.url)
    const files: URL[] = []
    const walk = (url: URL) => {
      for (const entry of fs.readdirSync(url, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(new URL(`${entry.name}/`, url))
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(new URL(entry.name, url))
      }
    }
    walk(root)
    const direct = files
      .filter((url) => !/\.(test|spec)\./.test(url.pathname))
      .filter((url) => !url.pathname.endsWith('/features/canvas/lightboxOpen.ts'))
      .filter((url) => !url.pathname.endsWith('/state/workbenches/canvas/store.ts'))
      .filter((url) => fs.readFileSync(url, 'utf8').includes('.openLightbox('))
      .map((url) => decodeURIComponent(url.pathname))
    expect(direct).toEqual([])
  })
})
