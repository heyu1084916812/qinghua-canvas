import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../../platform/memory'
import { createAssetLibraryRepository } from '../../../state/project/assetLibraryRepository'
import { saveDesignResearchItem } from './saveResearchItem'

beforeEach(() => registerAllSpecs())

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
])

describe('saveDesignResearchItem', () => {
  it('stores image bytes and a frozen asset-library row', async () => {
    const platform = createMemoryPlatform()
    const library = createAssetLibraryRepository(platform.storage)
    const network = {
      async request(req: import('../../../platform/ports').NetworkRequest) {
        expect(req.publicOnly).toBe(true)
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          text: async () => '',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => PNG.buffer.slice(0),
        }
      },
      async *stream() {},
    }
    const result = await saveDesignResearchItem(
      {
        id: 'pinterest:1',
        source: 'pinterest',
        title: 'Bakery reference',
        url: 'https://www.pinterest.com/pin/1/',
        imageUrl: 'https://cdn.example.com/bakery.png',
      },
      { network, storage: platform.storage },
      new AbortController().signal,
    )

    expect(result).toEqual({ ok: true, message: '已保存到素材库' })
    const rows = await platform.storage.query('assets', {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      mime: 'image/png',
      width: 1,
      height: 1,
      projectId: 'inspiration-library',
    })
    expect(await library.list()).toEqual([
      expect.objectContaining({
        mime: 'image/png',
        width: 1,
        height: 1,
        projectId: 'inspiration-library',
        prompt:
          'Bakery reference\n来源：https://www.pinterest.com/pin/1/\n' +
          '仅收集公开页面元数据与来源链接。图片权利归原作者所有，保存或商用前请核对来源许可。',
        tags: ['设计调研', 'Pinterest', 'pinterest.com'],
      }),
    ])
  })

  it('rejects non-image and missing-image sources without writing', async () => {
    const platform = createMemoryPlatform()
    const library = createAssetLibraryRepository(platform.storage)
    const network = {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          text: async () => '<html></html>',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => new TextEncoder().encode('html').buffer,
        }
      },
      async *stream() {},
    }
    const noImage = await saveDesignResearchItem(
      {
        id: 'web:1',
        source: 'web',
        title: 'No image',
        url: 'https://example.com',
        imageUrl: '',
      },
      { network, storage: platform.storage },
      new AbortController().signal,
    )
    const html = await saveDesignResearchItem(
      {
        id: 'web:2',
        source: 'web',
        title: 'HTML',
        url: 'https://example.com',
        imageUrl: 'https://example.com/page',
      },
      { network, storage: platform.storage },
      new AbortController().signal,
    )

    expect(noImage.ok).toBe(false)
    expect(html).toEqual({ ok: false, message: '来源返回的不是图片' })
    expect(await platform.storage.query('assets', {})).toEqual([])
    expect(await library.list()).toEqual([])
  })

  it('rejects a response whose image MIME disagrees with its bytes', async () => {
    const platform = createMemoryPlatform()
    const library = createAssetLibraryRepository(platform.storage)
    const network = {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          text: async () => '<html>not png</html>',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => new TextEncoder().encode('<html>not png</html>').buffer,
        }
      },
      async *stream() {},
    }
    const result = await saveDesignResearchItem(
      {
        id: 'web:3',
        source: 'web',
        title: 'Broken image',
        url: 'https://example.com/page',
        imageUrl: 'https://example.com/fake.png',
      },
      { network, storage: platform.storage },
      new AbortController().signal,
    )

    expect(result).toEqual({ ok: false, message: '来源返回的不是图片' })
    expect(await platform.storage.query('assets', {})).toEqual([])
    expect(await library.list()).toEqual([])
  })
})
