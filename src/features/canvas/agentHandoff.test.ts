import { describe, expect, it, vi } from 'vitest'
import {
  clearAgentHandoff,
  normalizeWebPageHandoff,
  sendReferenceToAgent,
  sendWebPageToAgent,
  subscribeWebPageAgentHandoff,
  takeWebPageAgentHandoff,
  WEB_PAGE_HANDOFF_IMAGE_LIMIT,
  sendSelectionToAgent,
  subscribeAgentHandoff,
  subscribeReferenceAgentHandoff,
  takeAgentHandoff,
  takeReferenceAgentHandoff,
} from './agentHandoff'

describe('agentHandoff', () => {
  it('accumulates and clears only the target project', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeAgentHandoff('p1', a)
    const offB = subscribeAgentHandoff('p2', b)

    sendSelectionToAgent('p1', ['node-1'])
    sendSelectionToAgent('p1', ['node-1', 'node-2'])

    expect(a).toHaveBeenLastCalledWith(['node-1', 'node-2'])
    expect(b).not.toHaveBeenCalled()
    expect(takeAgentHandoff('p2')).toEqual([])
    expect(takeAgentHandoff('p1')).toEqual(['node-1', 'node-2'])
    expect(takeAgentHandoff('p1')).toEqual([])

    offA()
    offB()
  })

  it('删除项目后清掉待消费节点与陈旧监听', () => {
    const listener = vi.fn()
    subscribeAgentHandoff('p1', listener)
    sendSelectionToAgent('p1', ['node-1'])
    clearAgentHandoff('p1')

    expect(takeAgentHandoff('p1')).toEqual([])
    sendSelectionToAgent('p1', ['node-2'])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('参考卡按项目累积去重，删除项目时同时清空', () => {
    const listener = vi.fn()
    const off = subscribeReferenceAgentHandoff('p1', listener)

    sendReferenceToAgent('p1', [
      { id: 'r1', label: '品牌标准字' },
      { id: 'r1', label: '品牌标准字（更新）' },
    ])
    sendReferenceToAgent('p1', [{ id: 'r2', label: '包装参考' }])

    expect(listener).toHaveBeenLastCalledWith([
      { id: 'r1', label: '品牌标准字（更新）' },
      { id: 'r2', label: '包装参考' },
    ])
    expect(takeReferenceAgentHandoff('p1')).toEqual([
      { id: 'r1', label: '品牌标准字（更新）' },
      { id: 'r2', label: '包装参考' },
    ])
    expect(takeReferenceAgentHandoff('p1')).toEqual([])

    sendReferenceToAgent('p1', [{ id: 'r3', label: '网页参考' }])
    clearAgentHandoff('p1')
    expect(takeReferenceAgentHandoff('p1')).toEqual([])
    off()
  })

  it('网页交接（#1089）：去重截断、同地址替换、取走即清空、项目隔离、清理', () => {
    const fn = vi.fn()
    const off = subscribeWebPageAgentHandoff('p1', fn)
    const many = Array.from({ length: 20 }, (_, i) => ({ imageUrl: `https://cdn.example.com/${i % 15}.jpg` }))
    const sent = sendWebPageToAgent('p1', { url: ' https://a.example/x ', title: ' A ', images: [{ imageUrl: 'blob:x' }, ...many] })
    expect(sent?.url).toBe('https://a.example/x')
    expect(sent?.title).toBe('A')
    expect(sent?.images).toHaveLength(WEB_PAGE_HANDOFF_IMAGE_LIMIT)
    expect(new Set(sent?.images.map((image) => image.imageUrl)).size).toBe(WEB_PAGE_HANDOFF_IMAGE_LIMIT)
    sendWebPageToAgent('p1', { url: 'https://a.example/x', title: 'A2', images: [] })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn.mock.calls[1]?.[0]).toEqual([{ url: 'https://a.example/x', title: 'A2', images: [] }])
    expect(sendWebPageToAgent('p1', { url: 'about:blank', title: '', images: [] })).toBeNull()
    expect(sendWebPageToAgent('', { url: 'https://b.example/', title: '', images: [] })).toBeNull()
    expect(takeWebPageAgentHandoff('p2')).toEqual([])
    expect(takeWebPageAgentHandoff('p1')).toHaveLength(1)
    expect(takeWebPageAgentHandoff('p1')).toEqual([])
    sendWebPageToAgent('p1', { url: 'https://c.example/', title: '', images: [] })
    clearAgentHandoff('p1')
    expect(takeWebPageAgentHandoff('p1')).toEqual([])
    off()
    expect(normalizeWebPageHandoff({ url: 'https://d.example/', title: '', images: [{ imageUrl: ' https://d.example/1.png ' }] }).images)
      .toEqual([{ imageUrl: 'https://d.example/1.png' }])
  })
})
