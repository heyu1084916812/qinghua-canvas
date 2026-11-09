import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../platform/ports'
import { searchOpenResearch } from './openResearchSearch'

function response(payload: unknown) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    text: async () => JSON.stringify(payload),
    json: async <T,>() => payload as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('searchOpenResearch', () => {
  it('searches Openverse images and Wikipedia content in parallel', async () => {
    const request = vi.fn<NetworkPort['request']>(async (input) => {
      if (input.url.startsWith('https://api.openverse.org/')) {
        return response({
          results: [{
            id: 'ov-1',
            title: 'Sustainable packaging',
            thumbnail: 'https://api.openverse.org/v1/images/ov-1/thumb/',
            foreign_landing_url: 'https://example.com/openverse-1',
            attribution: 'Photo by Example, CC BY',
            creator: 'Example',
            license: 'by',
            license_url: 'https://creativecommons.org/licenses/by/4.0/',
          }],
        })
      }
      return response({
        query: {
          pages: {
            42: {
              pageid: 42,
              index: 1,
              title: '可持续包装',
              fullurl: 'https://zh.wikipedia.org/wiki/可持续包装',
              extract: '可持续包装关注材料、回收与生命周期。',
              thumbnail: { source: 'https://upload.wikimedia.org/example.jpg' },
            },
          },
        },
      })
    })

    const result = await searchOpenResearch(
      { request, stream: async function* () {} },
      '可持续包装',
      8,
      new AbortController().signal,
    )

    expect(request).toHaveBeenCalledTimes(2)
    expect(result.warnings).toEqual([])
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'openverse:ov-1',
        source: 'openverse',
        imageUrl: 'https://api.openverse.org/v1/images/ov-1/thumb/',
      }),
      expect.objectContaining({
        id: 'wikipedia:42',
        source: 'wikipedia',
        title: '可持续包装',
        imageUrl: 'https://upload.wikimedia.org/example.jpg',
      }),
    ])
  })

  it('keeps the successful provider when the other fails', async () => {
    const request = vi.fn<NetworkPort['request']>(async (input) => {
      if (input.url.startsWith('https://api.openverse.org/')) {
        throw new Error('openverse offline')
      }
      return response({
        query: {
          pages: {
            7: {
              pageid: 7,
              title: 'Brand',
              fullurl: 'https://zh.wikipedia.org/wiki/Brand',
              extract: 'A brand is an identity.',
            },
          },
        },
      })
    })

    const result = await searchOpenResearch(
      { request, stream: async function* () {} },
      'brand',
      4,
      new AbortController().signal,
    )

    expect(result.items.map((item) => item.source)).toEqual(['wikipedia'])
    expect(result.warnings).toEqual([expect.stringContaining('Openverse')])
  })
})
