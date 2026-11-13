import { describe, expect, it, vi } from 'vitest'
import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../../platform/ports'
import { BROWSER_SITE_ADAPTERS } from './browserSiteAdapters'
import { HUABAN_SEARCH_ENDPOINT } from './huabanAdapter'
import { DIRECT_SITE_ADAPTERS, runSiteAdapters } from './runSiteAdapters'
import type { DirectSiteAdapter, SiteAdapterOutcome } from './types'
import { ZCOOL_SEARCH_ENDPOINT } from './zcoolAdapter'
import huabanFixture from './fixtures/huaban-search-pins.json?raw'
import zcoolFixture from './fixtures/zcool-search-content.html?raw'

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
  it('defaults to 花瓣 + 站酷 direct adapters and declares browser-only sites without requesting them', () => {
    expect(DIRECT_SITE_ADAPTERS.map((adapter) => adapter.label)).toEqual(['花瓣', '站酷'])
    expect(BROWSER_SITE_ADAPTERS.map((adapter) => adapter.id)).toEqual(['dribbble', 'thedieline', 'packagingoftheworld', 'pinterest'])
    expect(BROWSER_SITE_ADAPTERS.every((adapter) => adapter.kind === 'browser' && !adapter.search)).toBe(true)
  })

  it('runs the real adapters against recorded fixtures and interleaves both sites', async () => {
    const request = vi.fn<NetworkPort['request']>(async (req) => {
      if (req.url.startsWith(HUABAN_SEARCH_ENDPOINT)) return response(huabanFixture)
      if (req.url.startsWith(ZCOOL_SEARCH_ENDPOINT)) return response(zcoolFixture)
      throw new Error(`unexpected ${req.url}`)
    })
    const result = await runSiteAdapters(net(request), { queries: ['包装'], imageMaxResults: 10, delayMs: 0 }, new AbortController().signal)
    expect(result.usedSources).toEqual(['花瓣', '站酷'])
    expect(result.items).toHaveLength(10)
    expect(result.items.slice(0, 4).map((item) => item.source)).toEqual(['huaban', 'zcool', 'huaban', 'zcool'])
    expect(result.failures).toEqual([])
    expect(result.statuses.filter((status) => status.status === 'needs-browser')).toHaveLength(4)
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
    expect(result.failures).toHaveLength(2)
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
})
