import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../platform/ports'
import { createMemoryPlatform } from '../../../platform/memory'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import {
  captureClipperImage,
  captureClipperPage,
} from './clipperCapture'

const html = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="Oak chair" />
    <meta property="og:image" content="https://example.com/chair.jpg" />
  </head>
</html>`

describe('captureClipperPage', () => {
  it('uses one explicit public page and persists its real preview', async () => {
    const request = vi.fn<NetworkPort['request']>(async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      text: async () => html,
      json: async <T,>() => ({}) as T,
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)

    const result = await captureClipperPage({
      url: 'https://example.com/oak-chair',
      network: { request, stream: async function* () {} },
      collection,
      signal: new AbortController().signal,
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(result.items).toEqual([
      expect.objectContaining({
        title: 'Oak chair',
        imageUrl: 'https://example.com/chair.jpg',
      }),
    ])
    expect(result.collection).toHaveLength(1)
  })
})

describe('captureClipperImage', () => {
  it('collects a dropped image without fetching or expanding the page', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)

    const result = await captureClipperImage({
      pageUrl: 'https://example.com/collection',
      imageUrl: 'https://cdn.example.com/dropped.webp',
      title: 'Dropped reference',
      collection,
    })

    expect(result.items).toEqual([
      expect.objectContaining({
        title: 'Dropped reference',
        url: 'https://example.com/collection',
        imageUrl: 'https://cdn.example.com/dropped.webp',
      }),
    ])
    expect(result.collection).toHaveLength(1)
  })

  it('rejects non-public or non-HTTP image sources', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)

    await expect(captureClipperImage({
      pageUrl: 'https://example.com/collection',
      imageUrl: 'file:///tmp/local.png',
      collection,
    })).rejects.toThrow('不是公开 HTTP / HTTPS 地址')
  })
})
