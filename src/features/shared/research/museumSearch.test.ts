import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../platform/ports'
import { searchMuseumCollections } from './museumSearch'

function response(payload: unknown) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    text: async () => JSON.stringify(payload),
    json: async <T,>() => payload as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('searchMuseumCollections', () => {
  it('returns only CC0 Cleveland images and public-domain Met images', async () => {
    const request = vi.fn<NetworkPort['request']>(async (input) => {
      if (input.url.startsWith('https://openaccess-api.clevelandart.org/')) {
        return response({
          data: [{
            id: 127812,
            title: 'Yvette Guilbert',
            creation_date: 'c. 1894',
            description: 'Poster study',
            url: 'https://clevelandart.org/art/1950.455',
            share_license_status: 'CC0',
            creators: [{ description: 'Henri de Toulouse-Lautrec' }],
            images: {
              print: {
                url: 'https://openaccess-cdn.clevelandart.org/1950.455/1950.455_print.jpg',
              },
            },
          }],
        })
      }
      if (input.url.includes('/v1.1/search')) {
        return response({ objectIDs: [1, 2] })
      }
      if (input.url.endsWith('/objects/1')) {
        return response({
          objectID: 1,
          title: 'Open Met poster',
          objectURL: 'https://www.metmuseum.org/art/collection/search/1',
          primaryImageSmall: 'https://images.metmuseum.org/open.jpg',
          isPublicDomain: true,
          artistDisplayName: 'Public Artist',
        })
      }
      return response({
        objectID: 2,
        title: 'Copyrighted Met work',
        objectURL: 'https://www.metmuseum.org/art/collection/search/2',
        primaryImageSmall: 'https://images.metmuseum.org/closed.jpg',
        isPublicDomain: false,
      })
    })

    const result = await searchMuseumCollections(
      { request, stream: async function* () {} },
      'poster',
      4,
      new AbortController().signal,
    )

    expect(result.warnings).toEqual([])
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'cleveland:127812',
        source: 'cleveland',
        license: 'CC0',
      }),
      expect.objectContaining({
        id: 'met:1',
        source: 'met',
        license: 'Public Domain',
      }),
    ])
  })

  it('keeps one museum source when the other provider fails', async () => {
    const request = vi.fn<NetworkPort['request']>(async (input) => {
      if (input.url.startsWith('https://openaccess-api.clevelandart.org/')) {
        throw new Error('offline')
      }
      if (input.url.includes('/v1.1/search')) {
        return response({ objectIDs: [] })
      }
      return response({})
    })

    const result = await searchMuseumCollections(
      { request, stream: async function* () {} },
      'brand',
      2,
      new AbortController().signal,
    )

    expect(result.items).toEqual([])
    expect(result.warnings).toEqual([
      expect.stringContaining('Cleveland Museum'),
    ])
  })
})
