import { describe, expect, it, vi } from 'vitest'
import type { InspirationCase } from '../../../domain/inspiration/cases'
import type { NetworkPort } from '../../../platform/ports'
import { researchQueriesOf, runDesignResearch } from './designResearchRunner'
import { TAVILY_SEARCH_ENDPOINT } from './tavilySearch'
import { BING_IMAGE_ENDPOINT, BING_WEB_ENDPOINT } from './bingSearch'
import { TAVILY_OPTIONAL_HINT } from './fixedSiteSearch'
import { HUABAN_SEARCH_ENDPOINT } from './siteAdapters/huabanAdapter'
import { DIRECT_SITE_ADAPTERS } from './siteAdapters/runSiteAdapters'
import { ZCOOL_SEARCH_ENDPOINT } from './siteAdapters/zcoolAdapter'
import huabanFixture from './siteAdapters/fixtures/huaban-search-pins.json?raw'
import zcoolFixture from './siteAdapters/fixtures/zcool-search-content.html?raw'

const FIXTURES = import.meta.glob('./fixtures/*.html', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const fixture = (name: string): string => {
  const html = FIXTURES[`./fixtures/${name}`]
  if (html === undefined) throw new Error(`missing fixture ${name}`)
  return html
}
const isBing = (url: string) =>
  url.startsWith(BING_WEB_ENDPOINT) || url.startsWith(BING_IMAGE_ENDPOINT)
/** 设计站直连适配器（花瓣 / 站酷 / Cosmos / The Dieline / BP&O / Lovely Package）的请求。 */
const isSiteAdapter = (url: string) => {
  const host = new URL(url).hostname
  return DIRECT_SITE_ADAPTERS.some((adapter) => host === adapter.domain || host.endsWith(`.${adapter.domain}`))
}
function htmlResponse(html: string) {
  return {
    status: 200,
    headers: { 'content-type': 'text/html' },
    text: async () => html,
    json: async <T,>() => ({}) as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function networkWith(pages: Record<string, string>): NetworkPort {
  return {
    async request(req) {
      if (req.url.startsWith('https://api.openverse.org/')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '',
          json: async <T,>() => ({ results: [] }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      if (req.url.startsWith('https://zh.wikipedia.org/w/api.php')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '',
          json: async <T,>() => ({ query: { pages: {} } }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      if (req.url.startsWith('https://www.isci.si/search')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '',
          json: async <T,>() => ({ results: [] }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      if (req.url.startsWith('https://archive.org/advancedsearch.php')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '',
          json: async <T,>() => ({ response: { docs: [] } }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      if (req.url.startsWith('https://api.artic.edu/')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '',
          json: async <T,>() => ({ data: [] }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      if (req.url.startsWith('https://openaccess-api.clevelandart.org/')) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '',
          json: async <T,>() => ({ data: [] }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      if (req.url.startsWith(
        'https://collectionapi.metmuseum.org/public/collection/v1.1/search',
      )) {
        return {
          status: 200,
          headers: { 'content-type': 'application/json' },
          text: async () => '',
          json: async <T,>() => ({ objectIDs: [] }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
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
    // 用户给的 URL 排在最前，本地灵感库在后。
    expect(result.items.map((item) => item.source)).toEqual(['pinterest', 'web'])
    // 免费通道离线、也没填 Tavily Key：只提示“可选”，不再当作必须处理的错误。
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain(TAVILY_OPTIONAL_HINT)
    expect(result.needsTavilyKey).toBeUndefined()
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
    expect(result.warnings.filter((warning) => warning.includes('offline'))).toHaveLength(1)
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

    expect(request.mock.calls.some(([req]) => req.url === 'http://127.0.0.1:18765/state')).toBe(false)
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
    expect(result.warnings.join(' ')).toContain('没有找到可用参考')
  })

  it('does not fall back to unapproved open search providers', async () => {
    const request = vi.fn<NetworkPort['request']>(async () => {
      throw new Error('offline')
    })
    const result = await runDesignResearch(
      { topic: '可持续包装', maxResults: 6 },
      { network: { request, stream: async function* () {} } },
      new AbortController().signal,
    )

    expect(result.ok).toBe(false)
    expect(result.items).toEqual([])
    expect(result.needsTavilyKey).toBeUndefined()
    // 图片模式只请求了设计站直连适配器（publicOnly）；不走 Bing 图片，也没有 Openverse / Wikipedia 等未指定来源。
    expect(request).toHaveBeenCalled()
    for (const [req] of request.mock.calls) {
      expect(isSiteAdapter(req.url)).toBe(true)
      expect(req.publicOnly).toBe(true)
    }
  })

  it('Clipper mode reads only the requested page and skips open search', async () => {
    const request = vi.fn<NetworkPort['request']>(async (input) => {
      if (input.url !== 'https://example.com/clip') {
        throw new Error(`unexpected request ${input.url}`)
      }
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        text: async () =>
          '<title>Clipped</title><meta property="og:image" content="/clip.jpg">',
        json: async <T,>() => ({}) as T,
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    })
    const result = await runDesignResearch(
      {
        topic: 'https://example.com/clip',
        urls: ['https://example.com/clip'],
        includeOpenSearch: false,
      },
      { network: { request, stream: async function* () {} } },
      new AbortController().signal,
    )

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      title: 'Clipped',
      imageUrl: 'https://example.com/clip.jpg',
    })
    expect(request).toHaveBeenCalledOnce()
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
    expect(result.warnings.join(' ')).toContain('aborted')
  })

  it('mixed mode takes images from 花瓣 / 站酷 adapters and web pages from Bing, without Tavily or Bing images', async () => {
    const seen: string[] = []
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      seen.push(req.url)
      if (req.url.startsWith(HUABAN_SEARCH_ENDPOINT)) return htmlResponse(huabanFixture)
      if (req.url.startsWith(ZCOOL_SEARCH_ENDPOINT)) return htmlResponse(zcoolFixture)
      if (req.url.startsWith(BING_WEB_ENDPOINT)) return htmlResponse(fixture('bing-web.html'))
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await runDesignResearch(
      { topic: '茶包装', queries: ['tea packaging'], mode: 'mixed', maxResults: 8 },
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'k' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    expect(seen.some((url) => url === TAVILY_SEARCH_ENDPOINT)).toBe(false)
    expect(seen.some((url) => url.startsWith(BING_IMAGE_ENDPOINT))).toBe(false)
    const sources = new Set(result.items.map((item) => item.source))
    expect(sources).toEqual(new Set(['huaban', 'zcool', 'bing']))
    // Bing 只出网页，且只留固定设计站。
    const bingItems = result.items.filter((item) => item.source === 'bing')
    expect(bingItems.every((item) => item.imageUrl === '')).toBe(true)
    expect(bingItems.map((item) => new URL(item.url).hostname)).toEqual(['www.behance.net'])
    expect(result.usedSources).toEqual(['花瓣', '站酷', 'Bing'])
    expect(result.warnings).toEqual([])
  })

  it('image mode uses only the site adapters and never spends Tavily credits when they answer', async () => {
    const seen: string[] = []
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      seen.push(req.url)
      if (req.url.startsWith(HUABAN_SEARCH_ENDPOINT)) return htmlResponse(huabanFixture)
      if (req.url.startsWith(ZCOOL_SEARCH_ENDPOINT)) return htmlResponse(zcoolFixture)
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await runDesignResearch(
      { topic: '包装', queries: ['包装'], mode: 'image', imageMaxResults: 30 },
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'k', siteAdapterDelayMs: 0 },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    expect(seen.every(isSiteAdapter)).toBe(true)
    expect(result.items.every((item) => item.imageUrl !== '')).toBe(true)
    expect(result.items.slice(0, 2).map((item) => item.source)).toEqual(['huaban', 'zcool'])
    expect(result.usedSources).toEqual(['花瓣', '站酷'])
    // live-run bug 4：各站状态进工具结果，模型才知道哪些站没搜成
    expect(result.siteStatuses?.find((row) => row.site === '花瓣')).toMatchObject({ status: 'ok' })
    expect(result.siteStatuses?.find((row) => row.site === '花瓣')).not.toHaveProperty('note')
    expect(result.siteStatuses?.find((row) => row.site === 'Pinterest')).toMatchObject({ status: 'needs-browser', itemCount: 0 })
    expect(result.siteStatuses?.find((row) => row.site === 'Pinterest')?.note).toContain('内置浏览器')
  })

  it('image mode falls back to Tavily when the adapters return nothing (#1076)', async () => {
    const seen: string[] = []
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      seen.push(req.url)
      if (req.url.startsWith(HUABAN_SEARCH_ENDPOINT)) return htmlResponse('{"pins":[]}')
      if (req.url.startsWith(ZCOOL_SEARCH_ENDPOINT)) return htmlResponse('<div class="zm02cG_grid"></div>')
      if (req.url === TAVILY_SEARCH_ENDPOINT) {
        return {
          ...htmlResponse(''),
          json: async <T,>() => ({
            results: [],
            images: [{ url: 'https://cdn.example.com/box.jpg', description: 'box' }],
          }) as T,
        }
      }
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await runDesignResearch(
      { topic: '包装', queries: ['包装'], mode: 'image' },
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'k' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    expect(result.items.map((item) => item.source)).toEqual(['tavily'])
    expect(result.warnings[0]).toContain('花瓣没有找到相关结果')
    expect(result.warnings[0]).toContain('已改用 Tavily')
    expect(result.usedSources).toEqual(['Tavily'])
    expect(seen.some(isBing)).toBe(false)
  })

  it('falls back to Tavily only when the free Bing path hits a captcha', async () => {
    const seen: string[] = []
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      seen.push(req.url)
      if (isBing(req.url)) {
        return htmlResponse('<html><title>Verify</title><body>One last step: solve the captcha</body></html>')
      }
      if (req.url === TAVILY_SEARCH_ENDPOINT) {
        return {
          ...htmlResponse(''),
          json: async <T,>() => ({
            results: [{ title: 'Tea', url: 'https://www.behance.net/gallery/1/tea', content: 'tea' }],
          }) as T,
        }
      }
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await runDesignResearch(
      { topic: '茶包装', queries: ['tea packaging'], mode: 'web' },
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'k' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    expect(result.items.map((item) => item.source)).toEqual(['tavily'])
    expect(result.warnings[0]).toContain('人机验证')
    expect(result.warnings[0]).toContain('已改用 Tavily')
    expect(seen.filter((url) => url === TAVILY_SEARCH_ENDPOINT)).toHaveLength(1)
  })

  it('puts Tavily results first and skips the open-source fallback when Tavily answers', async () => {
    const seen: string[] = []
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      seen.push(req.url)
      if (req.url === TAVILY_SEARCH_ENDPOINT) {
        return {
          status: 200,
          headers: {},
          text: async () => '',
          json: async <T,>() => ({
            results: [{
              title: 'Coffee trends',
              url: 'https://t.example.com/a',
              content: 'c',
              score: 1,
              images: [{ url: 'https://t.example.com/hero.jpg', description: 'hero' }],
            }],
            images: [{ url: 'https://t.example.com/a.jpg', description: 'poster' }],
          }) as T,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await runDesignResearch(
      { topic: '咖啡海报', queries: ['咖啡海报 趋势', 'coffee poster trend 2026'], maxResults: 8 },
      { network: { request, stream: async function* () {} }, libraryCases: library, tavilyApiKey: 'k' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    expect(result.items[0]?.source).toBe('tavily')
    // 两个角度返回同样的链接，去重后只剩一份网页 + 一张图。
    expect(result.items.map((item) => item.source)).toEqual(['tavily', 'tavily'])
    const paid = seen.filter((url) => !isSiteAdapter(url))
    expect(paid.every((url) => url === TAVILY_SEARCH_ENDPOINT)).toBe(true)
    expect(paid).toHaveLength(2)
    expect(result.needsTavilyKey).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('Bearer')
  })

  it('image mode fills an independent 40-image target and dedupes merged page/top-level images', async () => {
    const seenRequests: Array<{ query: string; maxResults: number }> = []
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      if (isBing(req.url)) throw { kind: 'http', status: 429 }
      if (req.url !== TAVILY_SEARCH_ENDPOINT) throw new Error(`unexpected ${req.url}`)
      const body = req.body as { query: string; max_results: number }
      seenRequests.push({ query: body.query, maxResults: body.max_results })
      const prefix = body.query.replace(/\s+/g, '-')
      return {
        status: 200,
        headers: {},
        text: async () => '',
        json: async <T,>() => ({
          results: [
            {
              title: 'Shared hero',
              url: `https://pages.example.com/${prefix}`,
              content: 'shared',
              images: [{ url: 'https://cdn.example.com/shared.jpg' }],
            },
          ],
          images: [
            { url: 'https://cdn.example.com/shared.jpg', description: 'shared hero' },
            ...Array.from({ length: 20 }, (_, index) => ({
              url: `https://cdn.example.com/${prefix}-${index}.jpg`,
              description: `${prefix} ${index}`,
            })),
          ],
        }) as T,
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    })

    const result = await runDesignResearch(
      {
        topic: '复古海报素材',
        queries: ['retro poster one', 'retro poster two'],
        maxResults: 12,
        mode: 'image',
        imageMaxResults: 40,
      },
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'k' },
      new AbortController().signal,
    )

    expect(seenRequests).toHaveLength(2)
    expect(seenRequests.every((entry) => entry.maxResults === 20)).toBe(true)
    expect(result.request).toMatchObject({ mode: 'image', imageMaxResults: 40, maxResults: 12 })
    expect(result.totalItems).toBe(40)
    expect(new Set(result.items.map((item) => item.imageUrl)).size).toBe(40)
    expect(result.items.filter((item) => item.imageUrl === 'https://cdn.example.com/shared.jpg')).toHaveLength(1)
  })

  it('without a Tavily key keeps the local library and only hints that Tavily is optional', async () => {
    const network = networkWith({})
    const result = await runDesignResearch(
      { topic: 'bakery' },
      { network, libraryCases: library, tavilyApiKey: null },
      new AbortController().signal,
    )
    expect(result.needsTavilyKey).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('Tavily API Key 作为备用搜索（可选）')
    expect(result.items.some((item) => item.source === 'tavily')).toBe(false)
    expect(result.items.some((item) => item.source === 'openverse')).toBe(false)
    expect(result.items.some((item) => item.source === 'wikipedia')).toBe(false)
  })
})

describe('researchQueriesOf', () => {
  it('dedupes, trims and caps angles at four, falling back to the topic', () => {
    expect(researchQueriesOf('主题', [' a ', 'a', 'b', '', 'c', 'd', 'e'])).toEqual(['a', 'b', 'c', 'd'])
    expect(researchQueriesOf(' 主题 ')).toEqual(['主题'])
  })
})
