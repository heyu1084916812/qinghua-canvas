import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../../platform/ports'
import { cosmosAdapter, cosmosApolloPayloads, cosmosSearchUrl, parseCosmosSearch } from './cosmosAdapter'
import fixture from './fixtures/cosmos-search-elements.html?raw'

function response(text: string, status = 200) {
  return { status, headers: {}, text: async () => text, json: async <T,>() => ({}) as T, arrayBuffer: async () => new ArrayBuffer(0) }
}
const net = (request: NetworkPort['request']): NetworkPort => ({ request, stream: async function* () {} })

describe('Cosmos 直连适配器', () => {
  it('词放在路径里（robots 只禁带查询串的地址）', () => {
    expect(cosmosSearchUrl(' tea packaging ')).toBe('https://www.cosmos.so/search/elements/tea%20packaging')
    expect(cosmosSearchUrl('茶叶包装')).toBe('https://www.cosmos.so/search/elements/%E8%8C%B6%E5%8F%B6%E5%8C%85%E8%A3%85')
    expect(cosmosSearchUrl('a/b')).not.toContain('a/b')
  })

  it('读 Apollo 补水脚本（JS 字面量里的 undefined 也能解析）', () => {
    const payloads = cosmosApolloPayloads(fixture)
    expect(payloads).toHaveLength(1)
  })

  it('实录：8 条结果 → 7 张（AI 生成的那张跳过），标题取生成的说明、链接是 cosmos.so/e/<id>', () => {
    const { recognized, items } = parseCosmosSearch(fixture, 2)
    expect(recognized).toBe(true)
    expect(items).toHaveLength(7)
    expect(items.some((item) => item.id.endsWith(':1726476558'))).toBe(false)
    const deng = items.find((item) => item.id === 'cosmos:2:323991841')!
    expect(deng).toMatchObject({
      source: 'cosmos',
      title: 'Packaging design for 等等茶舖 by 四木設計 W/H Design Studio.',
      url: 'https://www.cosmos.so/e/323991841',
    })
    expect(deng.imageUrl).toMatch(/^https:\/\/cdn\.cosmos\.so\/[0-9a-f-]+\?format=jpeg&w=800$/)
    expect(deng.imageUrls?.[0]).toBe(deng.imageUrl.replace('?format=jpeg&w=800', ''))
    // 没有说明时用原出处作者名
    expect(items[0]!.title).toBe('IVORYHOdesign©｜Graphic 的收藏')
    expect(items[0]!.credit).toBe('IVORYHOdesign©｜Graphic')
  })

  it('没有补水数据（被拦 / 改版）⇒ 认不出；有数据但 0 条 ⇒ 空', async () => {
    expect(parseCosmosSearch('<html>Just a moment...</html>').recognized).toBe(false)
    const empty = '<script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate":{"a":{"data":{"searchElements":{"results":[]}}}}})</script>'
    expect(parseCosmosSearch(empty)).toEqual({ recognized: true, items: [] })
    expect((await cosmosAdapter.search(net(async () => response(empty)), { query: 'x', limit: 5, queryIndex: 0 }, new AbortController().signal)).status).toBe('empty')
    expect((await cosmosAdapter.search(net(async () => response('<html></html>')), { query: 'x', limit: 5, queryIndex: 0 }, new AbortController().signal)).status).toBe('unrecognized')
  })

  it('适配器：publicOnly 请求、按 limit 截断', async () => {
    const request = vi.fn<NetworkPort['request']>(async () => response(fixture))
    const outcome = await cosmosAdapter.search(net(request), { query: '茶叶包装设计', limit: 4, queryIndex: 0 }, new AbortController().signal)
    expect(outcome).toMatchObject({ id: 'cosmos', label: 'Cosmos', status: 'ok' })
    expect(outcome.items).toHaveLength(4)
    expect(request.mock.calls[0]![0]).toMatchObject({ publicOnly: true, url: cosmosSearchUrl('茶叶包装设计') })
  })
})
