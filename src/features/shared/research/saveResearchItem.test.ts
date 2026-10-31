import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../../platform/memory'
import type { StoragePort } from '../../../platform/ports'
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

function pngOfSize(width: number, height: number): Uint8Array {
  const bytes = PNG.slice()
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

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

  it('rejects decoded images above the shared research pixel limit', async () => {
    const platform = createMemoryPlatform()
    const library = createAssetLibraryRepository(platform.storage)
    const oversized = pngOfSize(5000, 5000)
    const network = {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          text: async () => '',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => Uint8Array.from(oversized).buffer,
        }
      },
      async *stream() {},
    }
    const result = await saveDesignResearchItem(
      {
        id: 'web:huge',
        source: 'web',
        title: 'Huge image',
        url: 'https://example.com/page',
        imageUrl: 'https://example.com/huge.png',
      },
      { network, storage: platform.storage },
      new AbortController().signal,
    )

    expect(result).toEqual({ ok: false, message: '图片超过 2000 万像素，已拒绝保存' })
    expect(await platform.storage.query('assets', {})).toEqual([])
    expect(await library.list()).toEqual([])
  })

  it('reports a readable message when public transport is unavailable', async () => {
    const platform = createMemoryPlatform()
    const network = {
      async request() {
        throw { kind: 'network', detail: 'blocked', sendPhase: 'not-sent' }
      },
      async *stream() {},
    }
    const result = await saveDesignResearchItem(
      {
        id: 'web:blocked',
        source: 'web',
        title: 'Blocked',
        url: 'https://example.com/page',
        imageUrl: 'https://example.com/image.png',
      },
      { network, storage: platform.storage },
      new AbortController().signal,
    )

    expect(result).toEqual({
      ok: false,
      message: '连不上：不允许访问本机、内网或链路本地地址',
    })
  })

  it('does not write after aborting once image bytes have arrived', async () => {
    const platform = createMemoryPlatform()
    const library = createAssetLibraryRepository(platform.storage)
    const controller = new AbortController()
    const network = {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          text: async () => '',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => {
            controller.abort()
            return Uint8Array.from(PNG).buffer
          },
        }
      },
      async *stream() {},
    }
    const result = await saveDesignResearchItem(
      {
        id: 'web:late-abort',
        source: 'web',
        title: 'Late abort',
        url: 'https://example.com/page',
        imageUrl: 'https://example.com/image.png',
      },
      { network, storage: platform.storage },
      controller.signal,
    )

    expect(result).toEqual({ ok: false, message: '保存已取消' })
    expect(await platform.storage.query('assets', {})).toEqual([])
    expect(await library.list()).toEqual([])
  })

  it('rolls back when aborted after the first asset-library write', async () => {
    const platform = createMemoryPlatform()
    const library = createAssetLibraryRepository(platform.storage)
    const controller = new AbortController()
    const original = platform.storage
    const storage: StoragePort = {
      ...original,
      transaction: (tables, run) =>
        original.transaction(tables, async (tx) => {
          const wrapped = new Proxy(tx, {
            get(target, property) {
              if (property === 'put') {
                return async (table: string, row: unknown) => {
                  await target.put(table as never, row as never)
                  if (table === 'assetLibrary') controller.abort()
                }
              }
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
          return run(wrapped)
        }),
    }
    const network = {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          text: async () => '',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => Uint8Array.from(PNG).buffer,
        }
      },
      async *stream() {},
    }
    const result = await saveDesignResearchItem(
      {
        id: 'web:mid-transaction-abort',
        source: 'web',
        title: 'Mid transaction abort',
        url: 'https://example.com/page',
        imageUrl: 'https://example.com/image.png',
      },
      { network, storage },
      controller.signal,
    )

    expect(result.ok).toBe(false)
    expect(await platform.storage.query('assets', {})).toEqual([])
    expect(await library.list()).toEqual([])
  })

  it('rolls back when aborted during the final tag read', async () => {
    const platform = createMemoryPlatform()
    const library = createAssetLibraryRepository(platform.storage)
    const controller = new AbortController()
    const original = platform.storage
    const storage: StoragePort = {
      ...original,
      transaction: (tables, run) =>
        original.transaction(tables, async (tx) => {
          const wrapped = new Proxy(tx, {
            get(target, property) {
              if (property === 'query') {
                return async (table: string, filter: unknown) => {
                  const result = await target.query(table as never, filter as never)
                  if (table === 'presets') controller.abort()
                  return result
                }
              }
              const value = Reflect.get(target, property, target)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
          return run(wrapped)
        }),
    }
    const network = {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          text: async () => '',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => Uint8Array.from(PNG).buffer,
        }
      },
      async *stream() {},
    }
    const result = await saveDesignResearchItem(
      {
        id: 'web:final-read-abort',
        source: 'web',
        title: 'Final read abort',
        url: 'https://example.com/page',
        imageUrl: 'https://example.com/image.png',
      },
      { network, storage },
      controller.signal,
    )

    expect(result.ok).toBe(false)
    expect(await platform.storage.query('assets', {})).toEqual([])
    expect(await library.list()).toEqual([])
  })
})
