import { describe, expect, it, vi } from 'vitest'
import {
  clearAgentHandoff,
  sendReferenceToAgent,
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
})
