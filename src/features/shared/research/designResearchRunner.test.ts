import { describe, expect, it, vi } from 'vitest'
import type { InspirationCase } from '../../../domain/inspiration/cases'
import type { NetworkPort } from '../../../platform/ports'
import { runDesignResearch } from './designResearchRunner'

function networkWith(pages: Record<string, string>): NetworkPort {
  return {
    async request(req) {
      const html = pages[req.url]
      if (html === undefined) throw new Error('offline')
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        text: async () => html,
        json: async <T,>() => ({}) as T,
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    },
    async *stream() {},
  }
}

const library: InspirationCase[] = [
  {
    id: 'local:1',
    sourceId: 'local',
    sourceName: 'Local',
    title: 'Minimal bakery packaging',
    prompt: 'warm minimal bakery identity',
    imageUrl: 'https://cdn.example.com/bakery.jpg',
    tags: ['bakery', 'minimal'],
    creditUrl: 'https://example.com/bakery',
  },
]

describe('runDesignResearch', () => {
  it('combines local inspiration with public Pinterest page metadata', async () => {
    const network = networkWith({
      'https://www.pinterest.com/pin/42/': [
        '<meta property="og:title" content="Warm bakery pin">',
        '<meta property="og:image" content="https://i.pinimg.com/564x/bakery.jpg">',
      ].join(''),
    })

    const result = await runDesignResearch(
      {
        topic: 'bakery',
        urls: ['https://www.pinterest.com/pin/42/'],
        maxResults: 8,
      },
      { network, libraryCases: library },
      new AbortController().signal,
    )

    expect(result.ok).toBe(true)
    expect(result.totalItems).toBe(2)
    expect(result.items.map((item) => item.source)).toEqual(['web', 'pinterest'])
    expect(result.warnings).toEqual([])
  })

  it('keeps successful pages and reports failed URLs without fabricating items', async () => {
    const network = networkWith({
      'https://example.com/project': [
        '<title>Editorial system</title>',
        '<meta property="og:image" content="/cover.jpg">',
      ].join(''),
    })

    const result = await runDesignResearch(
      {
        topic: 'editorial',
        urls: ['https://example.com/project', 'https://example.com/missing'],
      },
      { network },
      new AbortController().signal,
    )

    expect(result.ok).toBe(true)
    expect(result.totalItems).toBe(1)
    expect(result.items[0]).toMatchObject({
      source: 'web',
      title: 'Editorial system',
      url: 'https://example.com/project',
      imageUrl: 'https://example.com/cover.jpg',
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('offline')
  })

  it('uses the final redirect URL to resolve relative image metadata', async () => {
    const network: NetworkPort = {
      async request() {
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          finalUrl: 'https://final.example.com/campaign/',
          text: async () =>
            '<title>Redirected project</title><meta property="og:image" content="cover.jpg">',
          json: async <T,>() => ({}) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      },
      async *stream() {},
    }
    const result = await runDesignResearch(
      {
        topic: 'redirected',
        urls: ['https://short.example.com/start'],
      },
      { network },
      new AbortController().signal,
    )

    expect(result.items[0]).toMatchObject({
      url: 'https://final.example.com/campaign/',
      imageUrl: 'https://final.example.com/campaign/cover.jpg',
    })
  })

  it('skips private URLs without issuing a network request', async () => {
    const request = vi.fn<NetworkPort['request']>()
    const result = await runDesignResearch(
      {
        topic: 'private',
        urls: ['http://127.0.0.1:18765/state'],
      },
      { network: { request, stream: async function* () {} } },
      new AbortController().signal,
    )

    expect(request).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.items).toEqual([])
    expect(result.warnings[0]).toContain('不是公开互联网地址')
  })

  it('does not claim research success when no source can produce a reference', async () => {
    const result = await runDesignResearch(
      { topic: 'unknown' },
      { network: networkWith({}) },
      new AbortController().signal,
    )

    expect(result.ok).toBe(false)
    expect(result.items).toEqual([])
    expect(result.warnings.join(' ')).toContain('没有提供公开页面 URL')
    expect(result.warnings.join(' ')).toContain('没有找到可用参考')
  })

  it('honors cancellation through the network signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const request = vi.fn<NetworkPort['request']>(async () => {
      throw new DOMException('aborted', 'AbortError')
    })
    const result = await runDesignResearch(
      { topic: 'brand', urls: ['https://example.com'] },
      { network: { request, stream: async function* () {} } },
      controller.signal,
    )

    expect(result.ok).toBe(false)
    expect(result.items).toEqual([])
    expect(result.warnings[0]).toContain('aborted')
  })
})
