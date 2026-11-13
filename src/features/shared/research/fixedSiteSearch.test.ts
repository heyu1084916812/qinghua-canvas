import { describe, expect, it, vi } from 'vitest'
import type { AgentBrowserPort } from '../../../platform/agentBrowser'
import type { NetworkPort } from '../../../platform/ports'
import { BING_IMAGE_ENDPOINT, BING_WEB_ENDPOINT } from './bingSearch'
import { searchFixedDesignSites, TAVILY_OPTIONAL_HINT } from './fixedSiteSearch'
import { TAVILY_SEARCH_ENDPOINT } from './tavilySearch'
import { HUABAN_SEARCH_ENDPOINT } from './siteAdapters/huabanAdapter'
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

function response(text: string, body: unknown = {}) {
  return {
    status: 200,
    headers: {},
    text: async () => text,
    json: async <T,>() => body as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const isBing = (url: string) =>
  url.startsWith(BING_WEB_ENDPOINT) || url.startsWith(BING_IMAGE_ENDPOINT)

describe('searchFixedDesignSites', () => {
  it('image mode returns 花瓣 + 站酷 adapter results without touching Bing or Tavily even when a key is set', async () => {
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      if (req.url.startsWith(HUABAN_SEARCH_ENDPOINT)) return response(huabanFixture)
      if (req.url.startsWith(ZCOOL_SEARCH_ENDPOINT)) return response(zcoolFixture)
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await searchFixedDesignSites(
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'k', siteAdapterDelayMs: 0 },
      { queries: ['包装', 'packaging'], maxResults: 12, mode: 'image', imageMaxResults: 40 },
      new AbortController().signal,
    )
    expect(result.via).toBe('sites')
    expect(result.usedSources).toEqual(['花瓣', '站酷'])
    expect(result.items.length).toBeGreaterThan(10)
    expect(result.warnings).toEqual([])
    expect(request.mock.calls.some(([req]) => isBing(req.url) || req.url === TAVILY_SEARCH_ENDPOINT)).toBe(false)
    expect(result.siteStatuses.filter((status) => status.status === 'needs-browser').map((status) => status.label))
      .toEqual(['Dribbble', 'The Dieline', 'Packaging of the World', 'Pinterest'])
  })

  it('desktop agent browser: browser-only sites run too and report their own statuses (#1087)', async () => {
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      if (req.url.startsWith(HUABAN_SEARCH_ENDPOINT)) return response(huabanFixture)
      if (req.url.startsWith(ZCOOL_SEARCH_ENDPOINT)) return response(zcoolFixture)
      throw new Error(`unexpected ${req.url}`)
    })
    const loads: string[] = []
    const browser: AgentBrowserPort = {
      load: async (id, url) => {
        loads.push(`${id} ${url}`)
        return JSON.stringify({
          url,
          title: 'ok',
          images: id === 'dribbble'
            ? [{ src: 'https://cdn.dribbble.com/userupload/9/file/original-x.png?resize=800x600', width: 400, height: 300, alt: 'Tea', link: 'https://dribbble.com/shots/9-Tea', title: 'Tea' }]
            : [],
          signals: { passwordField: false, challengeMarkers: [], gatedCount: 0, textLength: 10 },
        })
      },
      snapshot: async () => '{}',
      show: async () => undefined,
      hide: async () => undefined,
      close: async () => undefined,
      subscribe: () => () => undefined,
    }
    const result = await searchFixedDesignSites(
      { network: { request, stream: async function* () {} }, siteAdapterDelayMs: 0, browserSites: { browser } },
      { queries: ['tea'], maxResults: 12, mode: 'image', imageMaxResults: 40 },
      new AbortController().signal,
    )
    expect(result.usedSources).toEqual(['花瓣', '站酷', 'Dribbble'])
    expect(result.items.some((item) => item.source === 'dribbble')).toBe(true)
    expect(loads.map((row) => row.split(' ')[0])).toEqual(['dribbble', 'thedieline', 'packagingoftheworld', 'pinterest'])
    expect(result.siteStatuses.map((status) => status.status)).toEqual(['ok', 'ok', 'ok', 'empty', 'empty', 'empty'])
  })

  it('web mode keeps the free Bing web path and does not call the image adapters', async () => {
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      if (req.url.startsWith(BING_WEB_ENDPOINT)) return response(fixture('bing-web.html'))
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await searchFixedDesignSites(
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'k' },
      { queries: ['tea'], maxResults: 12, mode: 'web' },
      new AbortController().signal,
    )
    expect(result.via).toBe('bing')
    expect(result.usedSources).toEqual(['Bing'])
    expect(result.siteStatuses).toEqual([])
    expect(request.mock.calls.every(([req]) => req.url.startsWith(BING_WEB_ENDPOINT))).toBe(true)
  })

  it('without a key reports the free-path reason and that Tavily is optional', async () => {
    const request = vi.fn<NetworkPort['request']>(async () => {
      throw { kind: 'http', status: 429 }
    })
    const result = await searchFixedDesignSites(
      { network: { request, stream: async function* () {} }, tavilyApiKey: '  ' },
      { queries: ['tea'], maxResults: 12 },
      new AbortController().signal,
    )
    expect(result).toMatchObject({ items: [], needsTavilyKey: false, via: 'none' })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('限流')
    expect(result.warnings[0]).toContain(TAVILY_OPTIONAL_HINT)
  })

  it('falls back to Tavily when the adapters return unrecognized pages and surfaces a rejected key', async () => {
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      if (isBing(req.url)) return response(fixture('bing-images-empty.html'))
      if (req.url === TAVILY_SEARCH_ENDPOINT) throw { kind: 'http', status: 401 }
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await searchFixedDesignSites(
      { network: { request, stream: async function* () {} }, tavilyApiKey: 'bad' },
      { queries: ['tea'], maxResults: 12, mode: 'image' },
      new AbortController().signal,
    )
    expect(result.via).toBe('none')
    expect(result.needsTavilyKey).toBe(true)
    expect(result.warnings[0]).toContain('已改用 Tavily')
    expect(result.warnings.join(' ')).toContain('401/403')
    expect(JSON.stringify(result)).not.toContain('bad')
  })
})
