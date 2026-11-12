import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort, NetworkRequest } from '../../../platform/ports'
import { BING_MIN_ON_SITE, bingPerSiteDomains, bingPerSiteQuery } from './bingPerSite'
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
      { queries: ['tea packaging', 'tea packaging'], mode: 'mixed', perSiteDelayMs: 0 },
      new AbortController().signal,
    )
    // 4 次 OR 查询（2 角度 × 网页/图片）；站内命中不足，再逐站补查（每类 4 站）。
    expect(request).toHaveBeenCalledTimes(12)
    for (const [req] of request.mock.calls.slice(0, 4)) {
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
    await searchBing(port, { queries: ['a'], mode: 'image', perSiteDelayMs: 0 }, new AbortController().signal)
    const imageCalls = seen.length
    await searchBing(port, { queries: ['a'], mode: 'web', perSiteDelayMs: 0 }, new AbortController().signal)
    expect(seen.slice(0, imageCalls).every((url) => url.startsWith(BING_IMAGE_ENDPOINT))).toBe(true)
    expect(seen.slice(imageCalls).every((url) => url.startsWith(BING_WEB_ENDPOINT))).toBe(true)
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
    const result = await searchBing(port, { queries: ['咖啡 包装'], mode: 'web', perSiteDelayMs: 0 }, new AbortController().signal)
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
    const result = await searchBing(port, { queries: ['a', 'b'], mode: 'image', perSiteDelayMs: 0 }, new AbortController().signal)
    expect(result.failure).toBe('captcha')
  })
})

/** 合成一页 Bing 图片结果（与真实页相同的 `a.iusc[m]` 结构），每条落在给定来源页。 */
function imagePage(pages: readonly string[], tag: string): string {
  const tiles = pages.map((page, index) => {
    const m = JSON.stringify({
      purl: page,
      murl: `https://img.example-cdn.com/${tag}-${index}.jpg`,
      turl: `https://ts1.mm.bing.net/th?id=${tag}-${index}`,
      t: `${tag} ${index}`,
    }).replace(/"/g, '&quot;')
    return `<li><div class="imgpt"><a class="iusc" m="${m}" href="#"></a></div></li>`
  })
  return `<html><body><div id="mmComponent_images_1" class="dgControl"><ul class="dgControl_list">${tiles.join('')}</ul></div></body></html>`
}

describe('searchBing per-site fallback (Bing ignores site: OR for anonymous requests)', () => {
  it('picks the top fixed sites, honouring an explicit domain list', () => {
    expect(bingPerSiteDomains()).toEqual(['pinterest.com', 'behance.net', 'dribbble.com', 'huaban.com'])
    expect(bingPerSiteDomains(['thedieline.com', 'behance.net'])).toEqual(['behance.net', 'thedieline.com'])
    expect(bingPerSiteQuery('咖啡 海报', 'huaban.com')).toBe('咖啡 海报 huaban site:huaban.com')
  })

  it('runs sequential per-site queries when the OR query yields too few on-site hits, keeping the host filter', async () => {
    const order: string[] = []
    const { request, port } = network(async (req) => {
      const q = new URL(req.url).searchParams.get('q') ?? ''
      order.push(q)
      if (q.includes(' OR ')) {
        // Bing 忽略了 OR 子句：只有 1 条站内，其余是 pexels。
        return html(imagePage(['https://www.pinterest.com/pin/1/', 'https://www.pexels.com/p/1'], 'or'))
      }
      const site = /site:(\S+)/.exec(q)?.[1] ?? ''
      // 逐站结果里混一条站外，验证域名过滤仍生效。
      return html(imagePage([
        ...Array.from({ length: 5 }, (_, i) => `https://www.${site}/item/${i}`),
        'https://unsplash.com/photos/x',
      ], site))
    })
    const result = await searchBing(
      port,
      { queries: ['咖啡 海报'], mode: 'image', perSiteDelayMs: 0 },
      new AbortController().signal,
    )
    expect(order[0]).toContain('(site:pinterest.com OR')
    // 1 + 5 + 5 = 11 < 12 → 第三站补齐 16 条后停（不查第 4 站）。
    expect(order.slice(1)).toEqual([
      '咖啡 海报 pinterest site:pinterest.com',
      '咖啡 海报 behance site:behance.net',
      '咖啡 海报 dribbble site:dribbble.com',
    ])
    expect(request).toHaveBeenCalledTimes(4)
    expect(result.items.length).toBeGreaterThanOrEqual(BING_MIN_ON_SITE.image)
    expect(result.items.every((item) => !/pexels|unsplash/.test(item.url))).toBe(true)
    expect(result.failure).toBeUndefined()
  })

  it('skips the per-site pass when the OR query already has enough on-site hits', async () => {
    const pages = Array.from({ length: 14 }, (_, i) => `https://www.behance.net/gallery/${i}`)
    const { request, port } = network(async () => html(imagePage(pages, 'enough')))
    const result = await searchBing(port, { queries: ['a'], mode: 'image', perSiteDelayMs: 0 }, new AbortController().signal)
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.items).toHaveLength(14)
  })

  it('waits between per-site requests and stops immediately on captcha', async () => {
    vi.useFakeTimers()
    try {
      let call = 0
      const { request, port } = network(async () => {
        call += 1
        if (call === 1) return html(fixture('bing-images-empty.html'))
        return call === 2 ? html(imagePage(['https://dribbble.com/shots/1'], 'p')) : html(fixture('bing-captcha.html'))
      })
      const pending = searchBing(port, { queries: ['a'], mode: 'image', perSiteDelayMs: 300 }, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(0)
      expect(request).toHaveBeenCalledTimes(2) // OR + 第一站，无需等待
      await vi.advanceTimersByTimeAsync(299)
      expect(request).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(request).toHaveBeenCalledTimes(3) // 第二站：验证码 → 停
      await vi.advanceTimersByTimeAsync(2000)
      const result = await pending
      expect(request).toHaveBeenCalledTimes(3)
      expect(result.items).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the per-site pass when aborted', async () => {
    const controller = new AbortController()
    const { request, port } = network(async () => {
      controller.abort()
      return html(fixture('bing-images-empty.html'))
    })
    await searchBing(port, { queries: ['a'], mode: 'image', perSiteDelayMs: 0 }, controller.signal)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
