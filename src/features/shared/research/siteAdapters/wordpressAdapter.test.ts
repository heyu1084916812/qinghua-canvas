import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../../platform/ports'
import { bpandoAdapter, parseWordPressPosts, theDielineAdapter, wordpressSearchUrl } from './wordpressAdapter'
import dielineFixture from './fixtures/thedieline-wp-posts.json?raw'
import bpandoFixture from './fixtures/bpando-wp-posts.json?raw'

function response(text: string, status = 200) {
  return { status, headers: {}, text: async () => text, json: async <T,>() => JSON.parse(text) as T, arrayBuffer: async () => new ArrayBuffer(0) }
}
const net = (request: NetworkPort['request']): NetworkPort => ({ request, stream: async function* () {} })
const DIELINE = { id: 'thedieline' as const, provider: 'thedieline' as const, label: 'The Dieline', domain: 'thedieline.com' }
const BPANDO = { id: 'bpando' as const, provider: 'bpando' as const, label: 'BP&O', domain: 'bpando.org' }

describe('WordPress REST 直连适配器（The Dieline / BP&O）', () => {
  it('搜索地址：posts + relevance 排序（不带时边缘缓存会忽略 search）+ 只嵌题图、只要必要字段', () => {
    const url = new URL(wordpressSearchUrl('thedieline.com', 'tea packaging', 99))
    expect(url.origin + url.pathname).toBe('https://thedieline.com/wp-json/wp/v2/posts')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'tea packaging',
      orderby: 'relevance',
      per_page: '20',
      _embed: 'wp:featuredmedia',
      _fields: 'id,title,link,_links,_embedded',
    })
  })

  it('The Dieline 实录：每篇一张题图，优先 large 档（i0.wp.com 图床也算本站），原图作备用；没有题图的跳过', () => {
    const { recognized, items } = parseWordPressPosts(JSON.parse(dielineFixture), DIELINE, 1)
    expect(recognized).toBe(true)
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({
      id: 'thedieline:1:539510',
      source: 'thedieline',
      title: '96 Degrees Turns Up the Charm with Tea Packaging Steeped in Style',
      url: 'https://thedieline.com/96-degrees-turns-up-the-charm-with-tea-packaging-steeped-in-style/',
      imageUrl: 'https://i0.wp.com/thedieline.com/wp-content/uploads/2025/10/96%C2%B0_Lineup_02-scaled-1.jpg?fit=1024%2C682&quality=70&ssl=1',
      description: 'The Dieline · 2560×1706',
    })
    expect(items[0]!.imageUrls).toContain('https://thedieline.com/wp-content/uploads/2025/10/96°_Lineup_02-scaled-1.jpg')
    // 实体解码：GOYO&#8217;s → GOYO’s
    expect(items[1]!.title).toBe('GOYO’s Tea Packaging Delivers Clarity, Calm, and Style')
    expect(items.some((item) => item.url.includes('no-image'))).toBe(false)
  })

  it('BP&O 实录：题图与链接都在 bpando.org', () => {
    const { items } = parseWordPressPosts(JSON.parse(bpandoFixture), BPANDO)
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({
      source: 'bpando',
      title: 'Double Diamond by Alec Tear',
      url: 'https://bpando.org/2025/10/28/beer-branding-packaging-double-diamond-by-alec-tear/',
      imageUrl: 'https://bpando.org/wp-content/uploads/double-diamond-branding-packaging-logo-character-bpo-reviews-1024x510.jpg',
    })
    expect(items[4]!.title).toBe('Tea & Glory by Socio Design')
  })

  it('给了检索词时过题目相关性闸门：BP&O「tea packaging design」只留真正讲茶的两篇', () => {
    const { items } = parseWordPressPosts(JSON.parse(bpandoFixture), BPANDO, 0, 'tea packaging design')
    expect(items.map((item) => item.title)).toEqual(['Fire Island Tea by Stephen Moss', 'Tea & Glory by Socio Design'])
    // The Dieline 的 6 篇标题都带 Tea，全部保留
    expect(parseWordPressPosts(JSON.parse(dielineFixture), DIELINE, 0, 'tea packaging').items).toHaveLength(6)
  })

  it('请求时去掉泛词、多要一些候选（闸门会筛掉一部分）', async () => {
    const request = vi.fn<NetworkPort['request']>(async () => response('[]'))
    await bpandoAdapter.search(net(request), { query: 'tea packaging design', limit: 4, queryIndex: 0 }, new AbortController().signal)
    const url = new URL(request.mock.calls[0]![0].url)
    expect(url.searchParams.get('search')).toBe('tea packaging')
    expect(url.searchParams.get('per_page')).toBe('10')
  })

  it('外站链接 / 外站题图一律不收', () => {
    const payload = [
      { id: 1, link: 'https://evil.example/x', title: { rendered: 'x' }, _embedded: { 'wp:featuredmedia': [{ source_url: 'https://bpando.org/wp-content/uploads/a.jpg' }] } },
      { id: 2, link: 'https://bpando.org/a/', title: { rendered: 'a' }, _embedded: { 'wp:featuredmedia': [{ source_url: 'https://evil.example/a.jpg' }] } },
      { id: 3, link: 'https://bpando.org/b/', title: { rendered: 'b' }, _embedded: { 'wp:featuredmedia': [{ media_type: 'file', source_url: 'https://bpando.org/wp-content/uploads/b.pdf' }] } },
    ]
    expect(parseWordPressPosts(payload, BPANDO).items).toEqual([])
    expect(parseWordPressPosts({ code: 'rest_forbidden' }, BPANDO).recognized).toBe(false)
  })

  it('适配器：publicOnly、浏览器 UA、按 limit 截断；0 条 = empty；拦截页 = unrecognized；429 = rate-limited', async () => {
    expect(theDielineAdapter.queryLanguage).toBe('en')
    const request = vi.fn<NetworkPort['request']>(async () => response(dielineFixture))
    const ok = await theDielineAdapter.search(net(request), { query: 'tea packaging', limit: 3, queryIndex: 0 }, new AbortController().signal)
    expect(ok.items.every((item) => /tea/i.test(item.title))).toBe(true)
    expect(ok.status).toBe('ok')
    expect(ok.items).toHaveLength(3)
    expect(request.mock.calls[0]![0]).toMatchObject({ publicOnly: true })
    expect(request.mock.calls[0]![0].headers?.['User-Agent']).toContain('Mozilla/5.0')
    expect((await bpandoAdapter.search(net(async () => response('[]')), { query: '茶', limit: 5, queryIndex: 0 }, new AbortController().signal)).status).toBe('empty')
    const blocked = await bpandoAdapter.search(net(async () => response('<!DOCTYPE html><title>Attention Required!</title>')), { query: 'tea', limit: 5, queryIndex: 0 }, new AbortController().signal)
    expect(blocked).toMatchObject({ status: 'unrecognized', failureText: 'BP&O搜索结果无法识别（可能被拦截或页面改版）' })
    expect((await bpandoAdapter.search(net(async () => response('', 429)), { query: 'tea', limit: 5, queryIndex: 0 }, new AbortController().signal)).status).toBe('rate-limited')
  })
})
