import { describe, expect, it } from 'vitest'
import type { NetworkPort } from '../../../../platform/ports'
import { lovelyPackageAdapter, lovelyPackageSearchUrl, parseLovelyPackageSearch } from './lovelyPackageAdapter'
import fixture from './fixtures/lovelypackage-search.html?raw'

function response(text: string, status = 200) {
  return { status, headers: {}, text: async () => text, json: async <T,>() => ({}) as T, arrayBuffer: async () => new ArrayBuffer(0) }
}
const net = (request: NetworkPort['request']): NetworkPort => ({ request, stream: async function* () {} })

describe('Lovely Package 直连适配器', () => {
  it('搜索地址：/?s=<词>', () => {
    expect(lovelyPackageSearchUrl(' tea packaging ')).toBe('https://lovelypackage.com/?s=tea+packaging')
  })

  it('实录：6 篇文章 → 6 张题图，标题解码，带尺寸后缀的图给出原图备用', () => {
    const { recognized, items } = parseLovelyPackageSearch(fixture, 1)
    expect(recognized).toBe(true)
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({
      id: 'lovelypackage:1:42378',
      source: 'lovelypackage',
      title: 'Sainsbury’s Tea Packaging Design',
      url: 'https://lovelypackage.com/sainsburys-tea-packaging-design/',
      imageUrl: 'https://lovelypackage.com/wp-content/uploads/2022/09/05_Tea.jpg',
    })
    expect(items[0]!.imageUrls).toBeUndefined()
    expect(items[1]!.title).toBe('Fairmont Hotels & Resorts Tea Packaging')
    expect(items[2]!.imageUrls).toEqual(['https://lovelypackage.com/wp-content/uploads/2024/04/HB-Summerberries-Peach.jpg'])
    // 站点 logo（svg）不算结果
    expect(items.some((item) => item.imageUrl.endsWith('.svg'))).toBe(false)
  })

  it('给了检索词时过题目相关性闸门：「tea packaging」不收 Beef & Steak；请求去掉泛词', async () => {
    const titles = parseLovelyPackageSearch(fixture, 0, 'tea packaging design').items.map((item) => item.title)
    expect(titles).toHaveLength(5)
    expect(titles).not.toContain('Packaging Design: Beef & Steak')
    const urls: string[] = []
    await lovelyPackageAdapter.search(net(async (req) => { urls.push(req.url); return response(fixture) }), { query: 'tea packaging design', limit: 9, queryIndex: 0 }, new AbortController().signal)
    expect(urls).toEqual(['https://lovelypackage.com/?s=tea+packaging'])
  })

  it('「没有结果」页 ⇒ empty；认不出的页面 ⇒ unrecognized', async () => {
    const nothing = '<div class="elementor-posts-nothing-found">It seems we can’t find what you’re looking for.</div>'
    expect(parseLovelyPackageSearch(nothing)).toEqual({ recognized: true, items: [] })
    expect((await lovelyPackageAdapter.search(net(async () => response(nothing)), { query: '茶叶', limit: 5, queryIndex: 0 }, new AbortController().signal)).status).toBe('empty')
    expect((await lovelyPackageAdapter.search(net(async () => response('<html>403 Access Forbidden</html>')), { query: 'tea', limit: 5, queryIndex: 0 }, new AbortController().signal)).status).toBe('unrecognized')
    expect((await lovelyPackageAdapter.search(net(async () => response(fixture)), { query: 'tea', limit: 2, queryIndex: 0 }, new AbortController().signal)).items).toHaveLength(2)
    expect(lovelyPackageAdapter.queryLanguage).toBe('en')
  })
})
