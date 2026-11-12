import { describe, expect, it, vi } from 'vitest'
import {
  clearAgentSkillHandoff,
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

  it('deleted projects cannot deliver a stale skill handoff', () => {
    const listener = vi.fn()
    subscribeAgentSkillHandoff('p1', listener)
    sendSkillToAgent('p1', 'skill_deleted')
    clearAgentSkillHandoff('p1')

    expect(takeAgentSkillHandoff('p1')).toBeNull()
    sendSkillToAgent('p1', 'skill_after_delete')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('agentSkillHandoff 队列（画布技能浮层连续加入，2026-11-12）', async () => {
  const mod = await import('./agentSkillHandoff')
  it('连续加入多个技能按顺序取出且去重', () => {
    mod.sendSkillToAgent('q1', 'a')
    mod.sendSkillToAgent('q1', 'b')
    mod.sendSkillToAgent('q1', 'a')
    expect(mod.takeAgentSkillHandoffs('q1', () => true)).toEqual(['a', 'b'])
    expect(mod.takeAgentSkillHandoffs('q1', () => true)).toEqual([])
  })

  it('认不出的 id 留在队列里，列表刷新后再取', () => {
    mod.sendSkillToAgent('q2', 'known')
    mod.sendSkillToAgent('q2', 'fresh')
    expect(mod.takeAgentSkillHandoffs('q2', (id) => id === 'known')).toEqual(['known'])
    expect(mod.takeAgentSkillHandoffs('q2', () => true)).toEqual(['fresh'])
  })

  it('打开技能库：有画布页订阅时投递并返回 true，否则 false', () => {
    const open = vi.fn()
    expect(mod.requestAgentSkillLibrary('q3')).toBe(false)
    const off = mod.subscribeAgentSkillLibraryRequest('q3', open)
    expect(mod.requestAgentSkillLibrary('q3')).toBe(true)
    expect(mod.requestAgentSkillLibrary('other')).toBe(false)
    expect(open).toHaveBeenCalledTimes(1)
    off()
    expect(mod.requestAgentSkillLibrary('q3')).toBe(false)
  })

  it('删除项目同时清掉技能库订阅', () => {
    mod.subscribeAgentSkillLibraryRequest('q4', () => {})
    mod.clearAgentSkillHandoff('q4')
    expect(mod.requestAgentSkillLibrary('q4')).toBe(false)
  })
})
