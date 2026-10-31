import { describe, expect, it, vi } from 'vitest'
import {
  sendSkillToAgent,
  subscribeAgentSkillHandoff,
  takeAgentSkillHandoff,
} from './agentSkillHandoff'

describe('agentSkillHandoff', () => {
  it('notifies the mounted Agent and clears only when consumed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAgentSkillHandoff(listener)

    sendSkillToAgent('skill_one')
    expect(listener).toHaveBeenCalledWith('skill_one')
    expect(takeAgentSkillHandoff()).toBe('skill_one')
    expect(takeAgentSkillHandoff()).toBeNull()

    unsubscribe()
  })

  it('ignores empty ids', () => {
    sendSkillToAgent('   ')
    expect(takeAgentSkillHandoff()).toBeNull()
  })
})
