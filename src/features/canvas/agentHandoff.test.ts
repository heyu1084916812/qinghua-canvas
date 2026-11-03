import { describe, expect, it, vi } from 'vitest'
import {
  clearAgentHandoff,
  sendSelectionToAgent,
  subscribeAgentHandoff,
  takeAgentHandoff,
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
})
