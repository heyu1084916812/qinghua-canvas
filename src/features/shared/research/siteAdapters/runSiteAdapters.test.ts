import { describe, expect, it, vi } from 'vitest'
import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../../platform/ports'
import { BROWSER_SITE_ADAPTERS } from './browserSiteAdapters'
import { HUABAN_SEARCH_ENDPOINT } from './huabanAdapter'
import { DIRECT_SITE_ADAPTERS, mergeSiteItems, queriesForSite, runSiteAdapters } from './runSiteAdapters'
import type { BrowserSiteAdapter, BrowserSiteContext, DirectSiteAdapter, SiteAdapterOutcome } from './types'
import { ZCOOL_SEARCH_ENDPOINT } from './zcoolAdapter'
import huabanFixture from './fixtures/huaban-search-pins.json?raw'
import zcoolFixture from './fixtures/zcool-search-content.html?raw'
import cosmosFixture from './fixtures/cosmos-search-elements.html?raw'
import dielineFixture from './fixtures/thedieline-wp-posts.json?raw'
import bpandoFixture from './fixtures/bpando-wp-posts.json?raw'
import lovelyFixture from './fixtures/lovelypackage-search.html?raw'

function response(text: string, status = 200) {
  return {
    status,
    headers: {},
    text: async () => text,
    json: async <T,>() => JSON.parse(text) as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const net = (request: NetworkPort['request']): NetworkPort => ({ request, stream: async function* () {} })

function fakeAdapter(id: 'huaban' | 'zcool', label: string, results: SiteAdapterOutcome['status'][], perCall = 2): DirectSiteAdapter & { calls: string[] } {
  const calls: string[] = []
  return {
    kind: 'direct',
    id,
    label,
    domain: `${id}.test`,
    calls,
    async search(_network, request) {
      calls.push(request.query)
      const status = results[calls.length - 1] ?? 'empty'
      const items: DesignResearchItem[] = status === 'ok'
        ? Array.from({ length: Math.min(perCall, request.limit) }, (_, i) => ({
            id: `${id}:${request.queryIndex}:${i}`,
            source: id,
            title: `${label}${request.queryIndex}-${i}`,
            url: `https://${id}.test/${request.queryIndex}/${i}`,
            imageUrl: `https://img.${id}.test/${request.queryIndex}/${i}.jpg`,
          }))
        : []
      return { id, label, status, items, ...(status === 'ok' ? {} : { failureText: `${label} ${status}` }) }
    },
  }
}

describe('runSiteAdapters', () => {
  it('defaults to six direct adapters; browser-only sites run through the agent browser (#1087)', () => {
    // 2026-11-14：加 Cosmos / BP&O / Lovely Package，The Dieline 从浏览器站改为 REST 直连
    expect(DIRECT_SITE_ADAPTERS.map((adapter) => adapter.label)).toEqual(['花瓣', '站酷', 'Cosmos', 'The Dieline', 'BP&O', 'Lovely Package'])
    expect(DIRECT_SITE_ADAPTERS.filter((adapter) => adapter.queryLanguage === 'en').map((adapter) => adapter.id))
      .toEqual(['thedieline', 'bpando', 'lovelypackage'])
    expect(BROWSER_SITE_ADAPTERS.map((adapter) => adapter.id)).toEqual(['dribbble', 'packagingoftheworld', 'pinterest'])
    expect(BROWSER_SITE_ADAPTERS.every((adapter) => adapter.kind === 'browser' && typeof adapter.search === 'function')).toBe(true)
  })

  it('runs the real adapters against recorded fixtures and interleaves all six sites', async () => {
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      if (req.url.startsWith(HUABAN_SEARCH_ENDPOINT)) return response(huabanFixture)
      if (req.url.startsWith(ZCOOL_SEARCH_ENDPOINT)) return response(zcoolFixture)
      if (req.url.startsWith('https://www.cosmos.so/search/elements/')) return response(cosmosFixture)
      if (req.url.startsWith('https://thedieline.com/wp-json/')) return response(dielineFixture)
      if (req.url.startsWith('https://bpando.org/wp-json/')) return response(bpandoFixture)
      if (req.url.startsWith('https://lovelypackage.com/?s=')) return response(lovelyFixture)
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await runSiteAdapters(net(request), { queries: ['包装', 'tea packaging'], imageMaxResults: 24, delayMs: 0 }, new AbortController().signal)
    expect(result.usedSources).toEqual(['花瓣', '站酷', 'Cosmos', 'The Dieline', 'BP&O', 'Lovely Package'])
    // 目标 24 ⇒ 每站 4；BP&O 过相关性闸门后只剩 2 篇讲茶的，换中文角度（不设闸门）再补
    expect(result.items.length).toBeGreaterThanOrEqual(22)
    expect(result.items.length).toBeLessThanOrEqual(24)
    expect(result.items.slice(0, 6).map((item) => item.source)).toEqual(['huaban', 'zcool', 'cosmos', 'thedieline', 'bpando', 'lovelypackage'])
    expect(result.failures).toEqual([])
    expect(result.statuses.filter((status) => status.status === 'needs-browser')).toHaveLength(3)
    // 英文站先用英文角度（WordPress / Lovely Package 中文词 0 条）；够数就不再发中文那条
    const urls = request.mock.calls.map(([req]) => req.url)
    for (const host of ['thedieline.com', 'bpando.org', 'lovelypackage.com']) {
      expect(urls.find((url) => url.includes(host))).toMatch(/tea(%20|\+)packaging/)
    }
    expect(urls.filter((url) => url.includes('thedieline.com'))).toHaveLength(1)
    expect(request.mock.calls.every(([req]) => req.publicOnly === true)).toBe(true)
    expect(request.mock.calls.some(([req]) => req.url.includes('bing.com'))).toBe(false)
  })

  it('walks query angles per site until the target is met, and stops a site on hard failures', async () => {
    const huaban = fakeAdapter('huaban', '花瓣', ['ok', 'ok', 'ok'], 2)
    const zcool = fakeAdapter('zcool', '站酷', ['rate-limited', 'ok'])
    const result = await runSiteAdapters(
      net(async () => { throw new Error('unused') }),
      { queries: ['a', 'b', 'c', 'd'], imageMaxResults: 8, delayMs: 0, direct: [huaban, zcool], browser: [] },
      new AbortController().signal,
    )
    // 目标 8 → 每站 4；花瓣每次 2 条，第 2 个角度就够数。
    expect(huaban.calls).toEqual(['a', 'b'])
    expect(zcool.calls).toEqual(['a'])
    expect(result.usedSources).toEqual(['花瓣'])
    expect(result.statuses.find((status) => status.id === 'zcool')).toMatchObject({ status: 'rate-limited', itemCount: 0 })
  })

  it('reports one failure line per direct site when nothing comes back', async () => {
    const result = await runSiteAdapters(
      net(async () => { throw { kind: 'network', detail: 'blocked' } }),
      { queries: ['包装'], imageMaxResults: 40, delayMs: 0 },
      new AbortController().signal,
    )
    expect(result.items).toEqual([])
    expect(result.usedSources).toEqual([])
    expect(result.failures).toHaveLength(DIRECT_SITE_ADAPTERS.length)
    expect(result.failures.join(' ')).toContain('只在桌面应用里可用')
  })

  it('stops between angles once aborted', async () => {
    const controller = new AbortController()
    const huaban = fakeAdapter('huaban', '花瓣', ['empty', 'ok'])
    const original = huaban.search
    huaban.search = async (...args) => {
      const out = await original(...args)
      controller.abort()
      return out
    }
    await runSiteAdapters(net(async () => { throw new Error('unused') }), { queries: ['a', 'b'], imageMaxResults: 4, delayMs: 0, direct: [huaban], browser: [] }, controller.signal)
    expect(huaban.calls).toEqual(['a'])
  })

  it('with the agent browser: browser sites run after 花瓣 + 站酷 and keep half of the slots', async () => {
    const huaban = fakeAdapter('huaban', '花瓣', ['ok', 'ok'], 10)
    const zcool = fakeAdapter('zcool', '站酷', ['ok', 'ok'], 10)
    const browserCalls: string[] = []
    const browserSite = (id: 'dribbble' | 'pinterest', label: string, status: SiteAdapterOutcome['status']): BrowserSiteAdapter => ({
      kind: 'browser',
      id,
      label,
      domain: `${id}.test`,
      reason: 'test',
      async search(_context, request) {
        browserCalls.push(`${id}:${request.query}:${request.limit}`)
        const items: DesignResearchItem[] = status === 'ok'
          ? Array.from({ length: 6 }, (_, i) => ({ id: `${id}:${i}`, source: id, title: `${label}${i}`, url: `https://${id}.test/${i}`, imageUrl: `https://img.${id}.test/${i}.jpg` }))
          : []
        return { id, label, status, items, ...(status === 'ok' ? {} : { failureText: `${label} ${status}` }) }
      },
    })
    const context = { browser: {} } as unknown as BrowserSiteContext
    const result = await runSiteAdapters(net(vi.fn()), {
      queries: ['tea', 'tea box'],
      imageMaxResults: 20,
      delayMs: 0,
      direct: [huaban, zcool],
      browser: [browserSite('dribbble', 'Dribbble', 'ok'), browserSite('pinterest', 'Pinterest', 'needs-login')],
      browserContext: context,
    }, new AbortController().signal)
    expect(result.usedSources).toEqual(['花瓣', '站酷', 'Dribbble'])
    // 前 10 张（一半名额）给直连站，接着是浏览器站点
    expect(result.items.slice(0, 10).every((item) => item.source === 'huaban' || item.source === 'zcool')).toBe(true)
    expect(result.items.slice(10, 16).map((item) => item.source)).toEqual(Array(6).fill('dribbble'))
    expect(result.statuses.map((status) => [status.label, status.status])).toEqual([
      ['花瓣', 'ok'], ['站酷', 'ok'], ['Dribbble', 'ok'], ['Pinterest', 'needs-login'],
    ])
    // 浏览器站点每站至少 8 张目标；needs-login 不是 empty，不换第二个检索角度
    expect(browserCalls).toEqual(['dribbble:tea:10', 'pinterest:tea:10'])
  })

  it('被验证 / 登录挡住的站即使留了零星条目也不算「搜到了」（bug 2）', async () => {
    const huaban = fakeAdapter('huaban', '花瓣', ['ok'], 4)
    const gated: BrowserSiteAdapter = {
      kind: 'browser',
      id: 'pinterest',
      label: 'Pinterest',
      domain: 'pinterest.test',
      reason: 'test',
      search: async () => ({
        id: 'pinterest',
        label: 'Pinterest',
        status: 'needs-login',
        items: [{ id: 'p', source: 'pinterest', title: 'Pin 图', url: 'https://pinterest.test/search', imageUrl: 'https://img.pinterest.test/p.jpg' }],
        failureText: 'Pinterest 需要登录',
      }),
    }
    const result = await runSiteAdapters(net(vi.fn()), {
      queries: ['tea'], imageMaxResults: 8, delayMs: 0, direct: [huaban], browser: [gated], browserContext: { browser: {} as never },
    }, new AbortController().signal)
    expect(result.usedSources).toEqual(['花瓣'])
    expect(result.statuses.find((status) => status.id === 'pinterest')!.status).toBe('needs-login')
  })

  it('一个站在等用户处理登录时，其它站跑完后只宽限一会儿：撤掉提示、先交出花瓣 / 站酷的结果（bug 1）', async () => {
    const huaban = fakeAdapter('huaban', '花瓣', ['ok'], 4)
    let promptSignal: AbortSignal | null = null
    const walled: BrowserSiteAdapter = {
      kind: 'browser',
      id: 'pinterest',
      label: 'Pinterest',
      domain: 'pinterest.test',
      reason: 'test',
      async search(context, _request, signal) {
        const decision = await context.resolveWall!({ siteId: 'pinterest', label: 'Pinterest', kind: 'login', reason: '需要登录', url: 'https://pinterest.test' }, signal)
        return { id: 'pinterest', label: 'Pinterest', status: decision === 'cancel' ? 'needs-login' : 'ok', items: [], failureText: 'Pinterest 需要登录' }
      },
    }
    // 提示自己永远不回答（用户走开了）；只有被撤掉（signal 中止）时才按取消返回
    const resolveWall = vi.fn((_request: unknown, signal: AbortSignal) => {
      promptSignal = signal
      return new Promise<'continue' | 'cancel'>((resolve) => signal.addEventListener('abort', () => resolve('cancel')))
    })
    const started = Date.now()
    const result = await runSiteAdapters(net(vi.fn()), {
      queries: ['tea'],
      imageMaxResults: 8,
      delayMs: 0,
      direct: [huaban],
      browser: [walled],
      browserContext: { browser: {} as never, resolveWall },
      deadlines: { wallGrace: 20 },
    }, new AbortController().signal)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(resolveWall).toHaveBeenCalledTimes(1)
    expect(promptSignal!.aborted).toBe(true)
    expect(result.usedSources).toEqual(['花瓣'])
    expect(result.statuses.find((status) => status.id === 'pinterest')).toMatchObject({ status: 'needs-login', itemCount: 0 })
  })

  it('每站时限：慢站到点被叫停并记「响应太慢」，不拖住其它站', async () => {
    const huaban = fakeAdapter('huaban', '花瓣', ['ok'], 4)
    const slow: DirectSiteAdapter = {
      kind: 'direct',
      id: 'zcool',
      label: '站酷',
      domain: 'zcool.test',
      search: (_network, _request, signal) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({ id: 'zcool', label: '站酷', status: 'network', items: [], failureText: '站酷连不上' }))
      }),
    }
    const result = await runSiteAdapters(net(vi.fn()), {
      queries: ['tea'], imageMaxResults: 8, delayMs: 0, direct: [huaban, slow], browser: [], deadlines: { direct: 20 },
    }, new AbortController().signal)
    expect(result.usedSources).toEqual(['花瓣'])
    expect(result.statuses.find((status) => status.id === 'zcool')).toMatchObject({ status: 'network', failureText: '站酷响应太慢，这次先跳过' })
  })

  it('英文站先用模型给的英文角度；没有英文角度就照原顺序（第一个打头）', async () => {
    expect(queriesForSite(['茶叶包装设计', 'tea packaging design', '茶叶礼盒包装', 'tea packaging'], 'en'))
      .toEqual(['tea packaging design', 'tea packaging', '茶叶包装设计', '茶叶礼盒包装'])
    expect(queriesForSite(['茶叶包装设计', '茶叶礼盒'], 'en')).toEqual(['茶叶包装设计', '茶叶礼盒'])
    expect(queriesForSite(['茶叶包装设计', 'tea packaging'])).toEqual(['茶叶包装设计', 'tea packaging'])
    expect(BROWSER_SITE_ADAPTERS.every((adapter) => adapter.queryLanguage === 'en')).toBe(true)

    const calls: string[] = []
    const english: BrowserSiteAdapter = {
      kind: 'browser', id: 'packagingoftheworld', label: 'POTW', domain: 'potw.test', reason: 'test', queryLanguage: 'en',
      async search(_context, request) {
        calls.push(request.query)
        return { id: 'packagingoftheworld', label: 'POTW', status: 'empty', items: [] }
      },
    }
    await runSiteAdapters(net(vi.fn()), {
      queries: ['茶叶包装设计', '茶叶礼盒包装', 'tea packaging'], imageMaxResults: 8, delayMs: 0, direct: [], browser: [english], browserContext: { browser: {} as never },
    }, new AbortController().signal)
    // 浏览器站只跑两个角度：英文那条一定在里面，而且排第一
    expect(calls).toEqual(['tea packaging', '茶叶包装设计'])
  })

  it('mergeSiteItems: without browser results the direct order is untouched', () => {
    const make = (source: 'huaban' | 'dribbble', n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `${source}${i}`, source, title: '', url: '', imageUrl: `${source}${i}` }) as DesignResearchItem)
    expect(mergeSiteItems(make('huaban', 5), [], 4).map((item) => item.id)).toEqual(['huaban0', 'huaban1', 'huaban2', 'huaban3', 'huaban4'])
    expect(mergeSiteItems(make('huaban', 5), make('dribbble', 5), 4).map((item) => item.id))
      .toEqual(['huaban0', 'huaban1', 'dribbble0', 'dribbble1', 'huaban2', 'huaban3', 'huaban4', 'dribbble2', 'dribbble3', 'dribbble4'])
    expect(mergeSiteItems([], make('dribbble', 2), 4).map((item) => item.id)).toEqual(['dribbble0', 'dribbble1'])
  })
})
