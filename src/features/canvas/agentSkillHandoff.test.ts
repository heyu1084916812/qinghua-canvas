import { describe, expect, it, vi } from 'vitest'
import {
  sendSkillToAgent,
  subscribeAgentSkillHandoff,
  takeAgentSkillHandoff,
} from './agentSkillHandoff'

describe('agentSkillHandoff', () => {
  it('notifies the mounted Agent and clears only when consumed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAgentSkillHandoff('p1', listener)

    sendSkillToAgent('p1', 'skill_one')
    expect(listener).toHaveBeenCalledWith('skill_one')
    expect(takeAgentSkillHandoff('p1')).toBe('skill_one')
    expect(takeAgentSkillHandoff('p1')).toBeNull()

    unsubscribe()
  })

  it('ignores empty ids', () => {
    sendSkillToAgent('p1', '   ')
    expect(takeAgentSkillHandoff('p1')).toBeNull()
  })

  it('keeps project handoffs isolated', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = subscribeAgentSkillHandoff('p1', a)
    const offB = subscribeAgentSkillHandoff('p2', b)

    sendSkillToAgent('p1', 'skill_a')

    expect(a).toHaveBeenCalledWith('skill_a')
    expect(b).not.toHaveBeenCalled()
    expect(takeAgentSkillHandoff('p2')).toBeNull()
    expect(takeAgentSkillHandoff('p1')).toBe('skill_a')

    offA()
    offB()
  })
})
