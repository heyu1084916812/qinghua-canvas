import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort, NetworkRequest } from '../../../platform/ports'
import {
  BING_IMAGE_ENDPOINT,
  BING_WEB_ENDPOINT,
  bingImageItemsOf,
  bingSearchUrl,
  bingWebItemsOf,
  searchBing,
} from './bingSearch'

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

function html(text: string, status = 200) {
  return {
    status,
    headers: { 'content-type': 'text/html' },
    text: async () => text,
    json: async <T,>() => ({}) as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function network(handler: (req: NetworkRequest) => Promise<ReturnType<typeof html>>) {
  const request = vi.fn<NetworkPort['request']>(handler)
  return { request, port: { request, stream: async function* () {} } as NetworkPort }
}

describe('bingSearchUrl', () => {
  it('builds web and image result page URLs with the encoded query', () => {
    const web = new URL(bingSearchUrl('web', '茶 包装 (site:behance.net OR site:dribbble.com)'))
    expect(`${web.origin}${web.pathname}`).toBe(BING_WEB_ENDPOINT)
    expect(web.searchParams.get('q')).toBe('茶 包装 (site:behance.net OR site:dribbble.com)')
    const image = new URL(bingSearchUrl('image', 'tea'))
    expect(`${image.origin}${image.pathname}`).toBe(BING_IMAGE_ENDPOINT)
    expect(image.searchParams.get('first')).toBe('1')
  })
})

describe('bing item projection', () => {
  it('keeps only fixed design sites and falls back to the Bing thumbnail', () => {
    const web = bingWebItemsOf([
      { title: 'Behance', url: 'https://www.behance.net/gallery/1', snippet: '' },
      { title: 'Other', url: 'https://99designs.com/x', snippet: 's' },
      { title: 'Private', url: 'http://127.0.0.1/behance.net', snippet: '' },
    ])
    expect(web).toEqual([
      {
        id: 'bing:0:web:0',
        source: 'bing',
        title: 'Behance',
        url: 'https://www.behance.net/gallery/1',
        imageUrl: '',
        description: 'Behance',
        credit: 'behance.net',
      },
    ])
    const images = bingImageItemsOf([
      {
        title: '',
        pageUrl: 'https://www.pinterest.com/pin/1/',
        imageUrl: 'https://i.pinimg.com/1.jpg',
        thumbnailUrl: 'https://tse1.mm.bing.net/th?id=1',
        description: '',
      },
      {
        title: 'no page',
        pageUrl: '',
        imageUrl: '',
        thumbnailUrl: 'https://tse1.mm.bing.net/th?id=2',
        description: '',
      },
      {
        title: 'stock',
        pageUrl: 'https://www.pexels.com/photo/1',
        imageUrl: 'https://images.pexels.com/1.jpg',
        thumbnailUrl: '',
        description: '',
      },
    ], 2)
    expect(images).toEqual([
      {
        id: 'bing:2:image:0',
        source: 'bing',
        title: '图片 · pinterest.com',
        url: 'https://www.pinterest.com/pin/1/',
        imageUrl: 'https://i.pinimg.com/1.jpg',
        imageUrls: ['https://tse1.mm.bing.net/th?id=1'],
        description: '来自 pinterest.com 的搜索图片',
        credit: 'pinterest.com',
      },
    ])
  })
})

describe('searchBing', () => {
  it('sends publicOnly GETs with a browser UA and the site: clause, then merges results', async () => {
    const { request, port } = network(async (req) =>
      html(fixture(req.url.startsWith(BING_IMAGE_ENDPOINT) ? 'bing-images.html' : 'bing-web.html')),
    )
    const result = await searchBing(
      port,
      { queries: ['tea packaging', 'tea packaging'], mode: 'mixed' },
      new AbortController().signal,
    )
    expect(request).toHaveBeenCalledTimes(4)
    for (const [req] of request.mock.calls) {
      expect(req.publicOnly).toBe(true)
      expect(req.method).toBe('GET')
      expect(req.headers?.['User-Agent']).toMatch(/Mozilla\/5\.0/)
      const q = new URL(req.url).searchParams.get('q') ?? ''
      expect(q).toContain('tea packaging (site:pinterest.com OR site:behance.net')
    }
    expect(result.failure).toBeUndefined()
    // 两个角度结果相同：按 URL / 图片去重后 1 网页 + 2 图。
    expect(result.items).toHaveLength(3)
    expect(result.items.filter((item) => item.imageUrl)).toHaveLength(2)
  })

  it('image mode only fetches the image page; web mode only the web page', async () => {
    const seen: string[] = []
    const { port } = network(async (req) => {
      seen.push(req.url)
      return html(fixture('bing-images.html'))
    })
    await searchBing(port, { queries: ['a'], mode: 'image' }, new AbortController().signal)
    await searchBing(port, { queries: ['a'], mode: 'web' }, new AbortController().signal)
    expect(seen[0]?.startsWith(BING_IMAGE_ENDPOINT)).toBe(true)
    expect(seen[1]?.startsWith(BING_WEB_ENDPOINT)).toBe(true)
  })

  it.each([
    ['captcha page', async () => html(fixture('bing-captcha.html')), 'captcha'],
    ['HTTP 429', async () => { throw { kind: 'http', status: 429 } }, 'rate-limited'],
    ['browser without desktop shell', async () => {
      throw { kind: 'network', detail: 'blocked', sendPhase: 'not-sent' }
    }, 'unavailable'],
    ['offline', async () => { throw new Error('offline') }, 'network'],
    ['empty result page', async () => html(fixture('bing-images-empty.html')), 'empty'],
    ['changed layout', async () => html('<html><body>new layout</body></html>'), 'unrecognized'],
    ['only off-site hits', async () => html(fixture('bing-web-zh.html')), 'off-site'],
  ] as const)('reports %s as a failure the caller can fall back on', async (_label, handler, failure) => {
    const { port } = network(handler as () => Promise<ReturnType<typeof html>>)
    const result = await searchBing(port, { queries: ['咖啡 包装'], mode: 'web' }, new AbortController().signal)
    expect(result.items).toEqual([])
    expect(result.failure).toBe(failure)
    expect(result.failureText).toBeTruthy()
  })

  it('prefers the most actionable failure when queries fail differently', async () => {
    let call = 0
    const { port } = network(async () => {
      call += 1
      return call === 1 ? html(fixture('bing-images-empty.html')) : html(fixture('bing-captcha.html'))
    })
    const result = await searchBing(port, { queries: ['a', 'b'], mode: 'image' }, new AbortController().signal)
    expect(result.failure).toBe('captcha')
  })
})
