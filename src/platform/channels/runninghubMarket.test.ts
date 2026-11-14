import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../memory'
import type { NetworkRequest } from '../ports'
import {
  billingOf,
  fetchRhMarketEntries,
  fetchRhMarketRelatedId,
  mapSkuRecord,
  runtimeOnly,
} from './runninghubMarket'
import { ChannelError } from './types'

const signal = new AbortController().signal

function json(status: number, body: unknown) {
  const payload = JSON.stringify(body)
  return {
    status,
    headers: { 'content-type': 'application/json' },
    async text() {
      return payload
    },
    async json<T>() {
      return JSON.parse(payload) as T
    },
    async arrayBuffer() {
      return new TextEncoder().encode(payload).buffer
    },
  }
}

describe('RunningHub 市场目录（#1113）', () => {
  it('priceType 1 = 只扣运行时长；2 = 另加第三方模型调用费', () => {
    expect(billingOf(1)).toBe('runtime')
    expect(billingOf(2)).toBe('runtime+model')
    /* 不认识的/缺省按"只扣运行时长"——它是最保守的展示（标成更贵的会挡住用户） */
    expect(billingOf(undefined)).toBe('runtime')
  })

  it('mapSkuRecord：缺 id / 缺名字的整条丢掉，不编假行', () => {
    expect(mapSkuRecord(null, 'WORKFLOW')).toBeNull()
    expect(mapSkuRecord({ name: '没有 id' }, 'WORKFLOW')).toBeNull()
    expect(mapSkuRecord({ id: '1' }, 'WORKFLOW')).toBeNull()
    expect(
      mapSkuRecord(
        {
          id: '2039234647940194305',
          name: '地表最强超能视频/全能参考 生真人视频(ID)-workflow',
          categoryName: '视频生视频',
          priceType: 2,
          backgroundUrl: 'https://x/cover.jpg',
          runCount: '12',
        },
        'WORKFLOW',
      ),
    ).toMatchObject({
      skuId: '2039234647940194305',
      kind: 'WORKFLOW',
      categoryName: '视频生视频',
      billing: 'runtime+model',
      coverUrl: 'https://x/cover.jpg',
      relatedDataId: '',
    })
  })

  it('runtimeOnly：只留「运行时长费用」那批', () => {
    const entries = [
      mapSkuRecord({ id: 'a', name: 'A', priceType: 1 }, 'WORKFLOW')!,
      mapSkuRecord({ id: 'b', name: 'B', priceType: 2 }, 'WORKFLOW')!,
    ]
    expect(runtimeOnly(entries).map((entry) => entry.skuId)).toEqual(['a'])
  })

  it('fetchRhMarketEntries：匿名 POST /api/sku/list，一次取全并映射', async () => {
    const seen: NetworkRequest[] = []
    const platform = createMemoryPlatform({
      handler: async (req) => {
        seen.push(req)
        return json(200, {
          code: 0,
          data: {
            page: {
              records: [
                { id: 'w1', name: 'Z-Image 文生图', categoryName: '文生图', priceType: 1 },
                { id: 'w2', name: '带第三方模型', categoryName: '图生视频', priceType: 2 },
                { name: '坏记录' },
              ],
            },
          },
        })
      },
    })
    const entries = await fetchRhMarketEntries(platform, { kind: 'WORKFLOW' }, signal)
    expect(entries.map((entry) => entry.skuId)).toEqual(['w1', 'w2'])
    expect(seen[0]!.url).toContain('/api/sku/list')
    expect(seen[0]!.body).toMatchObject({ categoryType: 'WORKFLOW', pageNum: 1, pageSize: 999 })
    expect(runtimeOnly(entries).map((entry) => entry.title)).toEqual(['Z-Image 文生图'])
  })

  it('fetchRhMarketEntries：目录接口报错时把服务端原话带出来', async () => {
    const platform = createMemoryPlatform({
      handler: async () => json(200, { code: 301, msg: '显示类型不能为空' }),
    })
    const err = (await fetchRhMarketEntries(platform, { kind: 'WEBAPP' }, signal).catch(
      (e: unknown) => e,
    )) as ChannelError
    expect(err).toBeInstanceOf(ChannelError)
    const appError = err.appError
    expect('body' in appError ? String(appError.body) : '').toContain('显示类型')
  })

  it('fetchRhMarketRelatedId：拿 relatedDataId；没有就明确报错', async () => {
    const platform = createMemoryPlatform({
      handler: async (req) => {
        expect(req.url).toContain('/api/sku/detail')
        expect(req.body).toMatchObject({ id: '2039234115011928065' })
        return json(200, { code: 0, data: { relatedDataId: '2037457807762526209' } })
      },
    })
    await expect(
      fetchRhMarketRelatedId(platform, '2039234115011928065', {}, signal),
    ).resolves.toBe('2037457807762526209')

    const empty = createMemoryPlatform({ handler: async () => json(200, { code: 0, data: {} }) })
    const err = (await fetchRhMarketRelatedId(empty, 'x', {}, signal).catch(
      (e: unknown) => e,
    )) as ChannelError
    expect(err).toBeInstanceOf(ChannelError)
    const appError = err.appError
    expect('raw' in appError ? String(appError.raw) : '').toContain('relatedDataId')
  })
})
