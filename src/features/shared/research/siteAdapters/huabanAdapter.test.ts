import { describe, expect, it, vi } from 'vitest'
import type { NetworkPort } from '../../../../platform/ports'
import { HUABAN_IMAGE_HOST, huabanAdapter, huabanSearchUrl, parseHuabanSearch } from './huabanAdapter'
import fixtureText from './fixtures/huaban-search-pins.json?raw'

function textResponse(text: string, status = 200) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    text: async () => text,
    json: async <T,>() => JSON.parse(text) as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe('huabanAdapter', () => {
  it('builds the v3 search URL with an encoded query and clamped page size', () => {
    const url = new URL(huabanSearchUrl('包装 设计', 99))
    expect(url.origin + url.pathname).toBe('https://huaban.com/v3/search/pins')
    expect(url.searchParams.get('q')).toBe('包装 设计')
    expect(url.searchParams.get('per_page')).toBe('40')
  })

  it('parses the recorded search JSON into unsigned thumbnails with signed / original fallbacks', () => {
    const { recognized, items } = parseHuabanSearch(JSON.parse(fixtureText))
    expect(recognized).toBe(true)
    expect(items).toHaveLength(8)
    const first = items[0]!
    expect(first).toMatchObject({
      id: 'huaban:0:6603684802',
      source: 'huaban',
      title: '独立包装',
      url: 'https://huaban.com/pins/6603684802',
      imageUrl: `${HUABAN_IMAGE_HOST}/8f9ff933270d15e23f0f8a945859d4e4bf3b36d831b7-GCMrtC_fw658webp`,
      credit: '嗷嗷嗷嗷哥',
    })
    expect(first.imageUrls?.[0]).toBe(`${HUABAN_IMAGE_HOST}/8f9ff933270d15e23f0f8a945859d4e4bf3b36d831b7-GCMrtC`)
    expect(first.imageUrls?.[1]).toMatch(/^https:\/\/gd-hbimg-edge\.huaban\.com\/.+\?auth_key=/)
    expect(first.description).toContain('512×512')
    // 无标题的采集用画板名兜底，不留空。
    expect(items.every((item) => item.title.length > 0)).toBe(true)
  })

  it('skips pins with unsafe keys or non-image files and reports unrecognized payloads', () => {
    const parsed = parseHuabanSearch({
      pins: [
        { pin_id: 1, file: { key: '../../etc/passwd', type: 'image/png' } },
        { pin_id: 2, file: { key: 'abcdefgh12345678-XyZ', type: 'video/mp4' } },
        { pin_id: 3, file: { key: 'abcdefgh12345678-XyZ', type: 'image/jpeg' }, raw_text: '<b>盒</b>' },
      ],
    })
    expect(parsed.items.map((item) => item.title)).toEqual(['盒'])
    expect(parseHuabanSearch({ error: 'blocked' })).toEqual({ recognized: false, items: [] })
  })

  it('searches through the public-only native path with browser headers and respects the limit', async () => {
    const request = vi.fn<NetworkPort['request']>(async () => textResponse(fixtureText))
    const outcome = await huabanAdapter.search(
      { request, stream: async function* () {} },
      { query: '包装', limit: 3, queryIndex: 1 },
      new AbortController().signal,
    )
    expect(outcome.status).toBe('ok')
    expect(outcome.items).toHaveLength(3)
    expect(outcome.items[0]!.id).toBe('huaban:1:6603684802')
    const [req] = request.mock.calls[0]!
    expect(req.publicOnly).toBe(true)
    expect(req.headers?.['User-Agent']).toMatch(/Mozilla\/5\.0/)
    expect(req.headers?.Cookie).toBeUndefined()
    expect(req.headers?.Referer).toBeUndefined()
  })

  it('classifies 429, desktop-only and HTML block pages without throwing', async () => {
    const run = (impl: NetworkPort['request']) =>
      huabanAdapter.search({ request: impl, stream: async function* () {} }, { query: 'x', limit: 5, queryIndex: 0 }, new AbortController().signal)
    expect((await run(async () => textResponse('', 429))).status).toBe('rate-limited')
    expect((await run(async () => { throw { kind: 'network', detail: 'blocked' } })).status).toBe('unavailable')
    const blocked = await run(async () => textResponse('<html>567</html>'))
    expect(blocked.status).toBe('unrecognized')
    expect(blocked.failureText).toContain('花瓣')
    expect((await run(async () => textResponse('{"pins":[]}'))).status).toBe('empty')
  })
})
