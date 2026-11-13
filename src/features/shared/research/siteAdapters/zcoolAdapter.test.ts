import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../../platform/ports'
import {
  parseZcoolSearch,
  zcoolAdapter,
  zcoolCardItems,
  zcoolInitialItems,
  zcoolRscText,
  zcoolSearchUrl,
} from './zcoolAdapter'
import fixture from './fixtures/zcool-search-content.html?raw'

function htmlResponse(text: string, status = 200) {
  return {
    status,
    headers: { 'content-type': 'text/html' },
    text: async () => text,
    json: async <T,>() => ({}) as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const SEARCH_URL = zcoolSearchUrl('包装')

describe('zcoolAdapter', () => {
  it('builds the search/content URL with the word parameter', () => {
    const url = new URL(SEARCH_URL)
    expect(url.origin + url.pathname).toBe('https://www.zcool.com.cn/search/content')
    expect(url.searchParams.get('word')).toBe('包装')
  })

  it('reads initialItems from the recorded RSC payload and keeps only works', () => {
    const rows = zcoolInitialItems(zcoolRscText(fixture))
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(9)
    const { recognized, items } = parseZcoolSearch(fixture, SEARCH_URL)
    expect(recognized).toBe(true)
    // 9 行 = 7 个作品 + 1 篇文章 + 1 个运营位；只留作品。
    expect(items).toHaveLength(7)
    expect(items[0]).toMatchObject({
      id: 'zcool:0:ZNjcxODc2NDA=',
      source: 'zcool',
      title: '岱山沙洋晒生/品牌包装',
      url: 'https://www.zcool.com.cn/work/ZNjcxODc2NDA=.html',
      credit: '禾作文创',
    })
    expect(items[0]!.imageUrl).toMatch(/^https:\/\/img\.zcool\.cn\/community\/.+w_1000/)
    expect(items[0]!.description).toContain('平面 / 包装')
    expect(items.every((item) => !/<|hightlight/.test(item.title))).toBe(true)
    expect(items.every((item) => item.url.includes('/work/'))).toBe(true)
  })

  it('falls back to normal-card-item cards when the RSC payload is missing', () => {
    const cardsOnly = fixture.replace(/<script>self\.__next_f[\s\S]*?<\/script>/g, '')
    expect(zcoolRscText(cardsOnly)).toBe('')
    const items = zcoolCardItems(cardsOnly, SEARCH_URL)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]).toMatchObject({ title: '岱山沙洋晒生/品牌包装', url: SEARCH_URL, source: 'zcool' })
    expect(items[0]!.imageUrl).toMatch(/^https:\/\/img\.zcool\.cn\/.+&t=/)
    expect(items[0]!.imageUrl).not.toContain('&amp;')
    expect(parseZcoolSearch(cardsOnly, SEARCH_URL).items).toEqual(items)
  })

  it('treats unrelated pages as unrecognized and an empty grid as empty', () => {
    expect(parseZcoolSearch('<html><body>验证</body></html>', SEARCH_URL)).toEqual({ recognized: false, items: [] })
    expect(parseZcoolSearch('<div class="zm02cG_grid"></div>', SEARCH_URL).recognized).toBe(true)
  })

  it('rejects off-site covers and pages', () => {
    const html = `<script>self.__next_f.push([1,${JSON.stringify(
      '"initialItems":[{"objectType":3,"title":"x","cover3x":"https://evil.example/a.jpg","pageUrl":"https://www.zcool.com.cn/work/a.html"},{"objectType":3,"title":"y","cover":"https://img.zcool.cn/a.jpg","pageUrl":"https://evil.example/w"}]',
    )}])</script>`
    expect(parseZcoolSearch(html, SEARCH_URL).items).toEqual([])
  })

  it('searches through the public-only native path and reports failures', async () => {
    const request = vi.fn<NetworkPort['request']>(async () => htmlResponse(fixture))
    const outcome = await zcoolAdapter.search(
      { request, stream: async function* () {} },
      { query: '包装', limit: 4, queryIndex: 0 },
      new AbortController().signal,
    )
    expect(outcome).toMatchObject({ id: 'zcool', label: '站酷', status: 'ok' })
    expect(outcome.items).toHaveLength(4)
    expect(request.mock.calls[0]![0]).toMatchObject({ url: SEARCH_URL, publicOnly: true })
    const failed = await zcoolAdapter.search(
      { request: async () => htmlResponse('', 503), stream: async function* () {} },
      { query: '包装', limit: 4, queryIndex: 0 },
      new AbortController().signal,
    )
    expect(failed.status).toBe('network')
    expect(failed.failureText).toContain('站酷')
  })
})
