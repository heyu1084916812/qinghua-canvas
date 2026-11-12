import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort, NetworkRequest } from '../../../platform/ports'
import {
  searchTavily,
  tavilyItemsOf,
  TAVILY_KEY_MISSING_MESSAGE,
  TAVILY_SEARCH_ENDPOINT,
} from './tavilySearch'
import { DESIGN_REFERENCE_DOMAINS } from './designReferenceSites'

function response(payload: unknown, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    text: async () => JSON.stringify(payload),
    json: async <T,>() => payload as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function networkOf(handler: (req: NetworkRequest) => unknown): NetworkPort {
  return {
    request: vi.fn(async (req: NetworkRequest) => handler(req)) as unknown as NetworkPort['request'],
    stream: vi.fn() as unknown as NetworkPort['stream'],
  }
}

const SAMPLE = {
  query: '咖啡品牌海报',
  images: [
    { url: 'https://img.example.com/a.jpg', description: '极简咖啡海报' },
    'https://img.example.com/b.jpg',
    { url: 'http://127.0.0.1/secret.png', description: '内网图' },
  ],
  results: [
    {
      title: '2026 咖啡品牌视觉趋势',
      url: 'https://design.example.com/coffee-trends',
      content: '复古字体与  高饱和色块\n成为主流。',
      score: 0.82,
      images: [{ url: 'https://design.example.com/hero.jpg', description: 'hero' }],
    },
    { title: '', url: 'https://www.blog.example.org/post', content: '正文摘要', score: 0.5 },
    { title: 'bad', url: 'javascript:alert(1)', content: 'x' },
  ],
  response_time: 1.2,
}

describe('tavilyItemsOf', () => {
  it('maps web results first, then images, keeping source links and dropping non-public urls', () => {
    const items = tavilyItemsOf(SAMPLE)
    expect(items.map((item) => item.url)).toEqual([
      'https://design.example.com/coffee-trends',
      'https://www.blog.example.org/post',
      'https://img.example.com/a.jpg',
      'https://img.example.com/b.jpg',
    ])
    expect(items[0]).toMatchObject({
      source: 'tavily',
      title: '2026 咖啡品牌视觉趋势',
      imageUrl: 'https://design.example.com/hero.jpg',
      description: '复古字体与 高饱和色块 成为主流。',
      credit: 'design.example.com',
    })
    expect(items[1]).toMatchObject({ title: 'blog.example.org', imageUrl: '' })
    expect(items[2]).toMatchObject({ title: '极简咖啡海报', imageUrl: 'https://img.example.com/a.jpg' })
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })

  it('falls back to the image title when its description is empty', () => {
    const items = tavilyItemsOf({
      results: [],
      images: [
        { url: 'https://img.example.com/a.jpg', title: '咖啡海报 A', description: '' },
        { url: 'https://img.example.com/b.jpg', title: '咖啡海报 B', description: '暖色手冲咖啡海报' },
      ],
    })
    expect(items.map((item) => item.title)).toEqual(['咖啡海报 A', '暖色手冲咖啡海报'])
    expect(items[0].description).toBe('咖啡海报 A')
  })

  it('tolerates an empty or malformed payload', () => {
    expect(tavilyItemsOf(null)).toEqual([])
    expect(tavilyItemsOf({ results: 'x', images: {} })).toEqual([])
  })
})

describe('searchTavily', () => {
  it('returns a clear setup message without touching the network when the key is missing', async () => {
    const network = networkOf(() => response({}))
    const result = await searchTavily(
      network,
      { apiKey: '  ', queries: ['咖啡海报'], maxResults: 12 },
      new AbortController().signal,
    )
    expect(result).toEqual({ items: [], warnings: [TAVILY_KEY_MISSING_MESSAGE], needsKey: true })
    expect(network.request).not.toHaveBeenCalled()
  })

  it('posts the documented body with a Bearer header, one request per angle (max 4)', async () => {
    const seen: NetworkRequest[] = []
    const network = networkOf((req) => {
      seen.push(req)
      return response(SAMPLE)
    })
    const result = await searchTavily(
      network,
      {
        apiKey: 'tvly-test-key',
        queries: ['a', 'b', ' ', 'c', 'd', 'e'],
        maxResults: 12,
        mode: 'web',
      },
      new AbortController().signal,
    )
    expect(seen).toHaveLength(4)
    expect(seen[0]).toMatchObject({
      url: TAVILY_SEARCH_ENDPOINT,
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tvly-test-key' }),
      body: {
        query: 'a',
        max_results: 3,
        search_depth: 'basic',
        include_images: false,
        include_image_descriptions: false,
        include_answer: false,
        include_domains: DESIGN_REFERENCE_DOMAINS,
      },
    })
    expect(seen[0]?.publicOnly).toBeUndefined()
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
  })

  it('uses the independent image target instead of the 12-result web cap', async () => {
    const seen: NetworkRequest[] = []
    const network = networkOf((req) => {
      seen.push(req)
      return response({ results: [], images: [] })
    })
    await searchTavily(
      network,
      {
        apiKey: 'tvly-test-key',
        queries: ['poster one', 'poster two'],
        maxResults: 12,
        mode: 'image',
        imageMaxResults: 40,
      },
      new AbortController().signal,
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]?.body).toMatchObject({
      max_results: 20,
      include_images: true,
      include_image_descriptions: true,
      include_domains: DESIGN_REFERENCE_DOMAINS,
    })
  })

  it('maps 401 to a settings hint and never echoes the key', async () => {
    const network = networkOf(() => {
      throw { kind: 'http', status: 401, body: '{"detail":{"error":"Unauthorized"}}' }
    })
    const result = await searchTavily(
      network,
      { apiKey: 'tvly-secret-value', queries: ['x'], maxResults: 5 },
      new AbortController().signal,
    )
    expect(result.needsKey).toBe(true)
    expect(result.warnings[0]).toContain('设置 → Agent → 工具 → 联网调研')
    expect(JSON.stringify(result)).not.toContain('tvly-secret-value')
  })

  it('keeps other angles when one fails and reports quota exhaustion', async () => {
    let call = 0
    const network = networkOf(() => {
      call += 1
      if (call === 1) throw { kind: 'http', status: 432 }
      return response(SAMPLE)
    })
    const result = await searchTavily(
      network,
      { apiKey: 'k', queries: ['one', 'two'], maxResults: 10 },
      new AbortController().signal,
    )
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.needsKey).toBe(true)
    expect(result.warnings[0]).toContain('额度')
    expect(result.warnings[0]).toContain('one')
  })
})
