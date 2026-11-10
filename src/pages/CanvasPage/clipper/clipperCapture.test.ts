import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../platform/ports'
import { createMemoryPlatform } from '../../../platform/memory'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import {
  captureClipperImage,
  captureClipperPage,
  capturePendingClipperClip,
} from './clipperCapture'
import { capturePendingClipperQueue } from './clipperQueueCapture'

const html = `<!doctype html>
<html>
  <head>
    <meta property="og:title" content="Oak chair" />
    <meta property="og:image" content="https://example.com/chair.jpg" />
  </head>
</html>`

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
])

function imageResponse(bytes = PNG) {
  return {
    status: 200,
    headers: { 'content-type': 'image/png' },
    text: async () => '',
    json: async <T,>() => ({}) as T,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ),
  }
}

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
      network: { request: vi.fn(async () => imageResponse()), stream: async function* () {} },
      signal: new AbortController().signal,
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
      network: { request: vi.fn(), stream: async function* () {} },
      signal: new AbortController().signal,
      collection,
    })).rejects.toThrow('不是公开 HTTP / HTTPS 地址')
  })

  it('rejects a page URL masquerading as a dropped image', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)

    await expect(captureClipperImage({
      pageUrl: 'https://huaban.com/search?q=poster',
      imageUrl: 'https://huaban.com/search?q=poster',
      network: { request: vi.fn(), stream: async function* () {} },
      signal: new AbortController().signal,
      collection,
    })).rejects.toThrow('把网页地址当成了图片地址')
  })

  it('rejects a page or placeholder that is not an actual image', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)
    await expect(captureClipperImage({
      pageUrl: 'https://example.com/collection',
      imageUrl: 'https://example.com/not-an-image',
      network: {
        request: vi.fn(async () => ({
          ...imageResponse(),
          headers: { 'content-type': 'text/html' },
          arrayBuffer: async () => new TextEncoder().encode('<html>').buffer,
        })),
        stream: async function* () {},
      },
      signal: new AbortController().signal,
      collection,
    })).rejects.toThrow('没有识别到可导入的图片')
  })

  it('falls back to another original URL for the same dragged image', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)
    const request = vi.fn(async (input: { url: string }) => {
      if (input.url.endsWith('/blocked-thumb.webp')) {
        return {
          ...imageResponse(),
          status: 403,
          headers: { 'content-type': 'text/html' },
          arrayBuffer: async () => new TextEncoder().encode('<html>blocked</html>').buffer,
        }
      }
      return imageResponse()
    })

    const result = await capturePendingClipperClip({
      pageUrl: 'https://huaban.com/pins/example',
      imageUrl: 'https://cdn.example.com/blocked-thumb.webp',
      imageUrls: [
        'https://cdn.example.com/blocked-thumb.webp',
        'https://cdn.example.com/original.webp',
      ],
      title: 'Huaban original',
      network: { request, stream: async function* () {} },
      signal: new AbortController().signal,
      collection,
    })

    expect(request.mock.calls.map((call) => call[0].url)).toEqual([
      'https://cdn.example.com/blocked-thumb.webp',
      'https://cdn.example.com/original.webp',
    ])
    expect(result.items[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/original.webp',
      imageUrls: ['https://cdn.example.com/blocked-thumb.webp'],
    })
    expect(result.warnings).toEqual(['原图地址不可用，已使用备用地址'])
  })

  it('does not fall back to a page preview when the drag has no image', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)

    await expect(capturePendingClipperClip({
      pageUrl: 'https://huaban.com/',
      network: { request: vi.fn(), stream: async function* () {} },
      collection,
      signal: new AbortController().signal,
    })).rejects.toThrow('没有识别到拖拽的图片')
  })
})

describe('capturePendingClipperQueue', () => {
  it('acks only imported clips and reports retryable failures', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)
    const result = await capturePendingClipperQueue({
      clips: [
        {
          id: 'clip-ok',
          url: 'https://example.com/collection',
          imageUrl: 'https://cdn.example.com/dropped.webp',
        imageUrls: ['https://cdn.example.com/original.webp'],
          title: 'Dropped reference',
        },
        {
          id: 'clip-failed',
          url: 'https://example.com/collection',
          imageUrl: 'file:///tmp/local.png',
          title: 'Invalid local image',
        },
      ],
      network: { request: vi.fn(async () => imageResponse()), stream: async function* () {} },
      collection,
      signal: new AbortController().signal,
    })

    expect(result.imported).toBe(1)
    expect(result.importedIds).toEqual(['clip-ok'])
    expect(result.discardedIds).toEqual(['clip-failed'])
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'clip-failed', retryable: false }),
    ])
    expect(result.collection).toHaveLength(1)
  })

  it('keeps temporary network failures queued for retry', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)
    const result = await capturePendingClipperQueue({
      clips: [{
        id: 'clip-retry',
        url: 'https://example.com/collection',
        imageUrl: 'https://cdn.example.com/dropped.webp',
      }],
      network: {
        request: vi.fn(async () => {
          throw new Error('temporary network failure')
        }),
        stream: async function* () {},
      },
      collection,
      signal: new AbortController().signal,
    })

    expect(result.imported).toBe(0)
    expect(result.importedIds).toEqual([])
    expect(result.discardedIds).toEqual([])
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'clip-retry', retryable: true }),
    ])
  })

  it('keeps anti-bot server responses queued instead of discarding the image', async () => {
    const platform = createMemoryPlatform()
    const collection = createClipperCollectionRepository(platform.storage)
    const result = await capturePendingClipperQueue({
      clips: [{
        id: 'clip-antibot',
        url: 'https://huaban.com/pins/example',
        imageUrl: 'https://gd-hbimg.huaban.com/example.webp',
      }],
      network: {
        request: vi.fn(async () => ({
          ...imageResponse(),
          status: 567,
          headers: { 'content-type': 'text/html' },
          arrayBuffer: async () => new TextEncoder().encode('<html>').buffer,
        })),
        stream: async function* () {},
      },
      collection,
      signal: new AbortController().signal,
    })

    expect(result.discardedIds).toEqual([])
    expect(result.failed).toEqual([
      expect.objectContaining({ id: 'clip-antibot', retryable: true }),
    ])
  })
})
