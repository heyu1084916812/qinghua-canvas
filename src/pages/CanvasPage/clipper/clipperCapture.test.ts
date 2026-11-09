import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../platform/ports'
import { createMemoryPlatform } from '../../../platform/memory'
import { createClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import { captureClipperPage } from './clipperCapture'

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
