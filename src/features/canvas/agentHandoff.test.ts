import { describe, expect, it, vi } from 'vitest'
import {
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
})
