import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  useAgentSkillChipReset,
  type AgentSkillChipResetInput,
} from './useAgentSkillChipReset'

function session(id = 's1', skillId?: string): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
    ...(skillId ? { skillId } : {}),
  }
}

const chip = (id = 'skill-1') => `@[技能](${'skill:'}${id})`

function harness(over: Partial<AgentSkillChipResetInput> = {}) {
  const setSkill = vi.fn(async () => {})
  const runPromiseDetached = vi.fn()
  const input: AgentSkillChipResetInput = {
    current: session('s1', 'skill-1'),
    draft: '',
    setSkill,
    runPromiseDetached,
    ...over,
  }
  return { input, setSkill, runPromiseDetached }
}

function render(props: AgentSkillChipResetInput): {
  update: (next: AgentSkillChipResetInput) => void
} {
  function Probe(next: AgentSkillChipResetInput) {
    useAgentSkillChipReset(next)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe, props))
  })
  return {
    update: (next) => {
      act(() => renderer.update(createElement(Probe, next)))
    },
  }
}

describe('useAgentSkillChipReset', () => {
  it('没有当前技能时什么都不做', () => {
    const h = harness({ current: session('s1'), draft: chip() })
    render(h.input)

    expect(h.setSkill).not.toHaveBeenCalled()
    expect(h.runPromiseDetached).not.toHaveBeenCalled()
  })

  it('首帧就带着 chip 不算"删除"（没看见过）', () => {
    const h = harness({ draft: chip() })
    render(h.input)

    expect(h.runPromiseDetached).not.toHaveBeenCalled()
  })

  it('看见过 chip 之后被删掉，且草稿仍有内容 → 清一次技能设置', () => {
    const h = harness({ draft: '' })
    const { update } = render(h.input)

    update({ ...h.input, draft: `写个方案 ${chip()}` })
    expect(h.runPromiseDetached).not.toHaveBeenCalled()

    update({ ...h.input, draft: '写个方案' })
    expect(h.setSkill).toHaveBeenCalledWith('')
    expect(h.runPromiseDetached).toHaveBeenCalledWith(
      expect.any(Promise),
      '清除技能设置失败',
    )
  })

  it('只触发一次：同一份草稿再渲染不会重复清', () => {
    const h = harness({ draft: '' })
    const { update } = render(h.input)

    update({ ...h.input, draft: `写个方案 ${chip()}` })
    update({ ...h.input, draft: '写个方案' })
    update({ ...h.input, draft: '写个方案' })

    expect(h.setSkill).toHaveBeenCalledTimes(1)
  })

  it('换会话不算删除（sessionId 变了）', () => {
    const h = harness({ draft: `写个方案 ${chip()}` })
    const { update } = render(h.input)

    update({ ...h.input, current: session('s2', 'skill-1'), draft: '写个方案' })

    expect(h.runPromiseDetached).not.toHaveBeenCalled()
  })

  it('换技能不算删除（skillId 变了）', () => {
    const h = harness({ draft: `写个方案 ${chip()}` })
    const { update } = render(h.input)

    update({
      ...h.input,
      current: session('s1', 'skill-2'),
      draft: '写个方案',
    })

    expect(h.runPromiseDetached).not.toHaveBeenCalled()
  })

  it('草稿被清空（只剩空白）不算"用户在写"', () => {
    const h = harness({ draft: `写个方案 ${chip()}` })
    const { update } = render(h.input)

    update({ ...h.input, draft: '   ' })

    expect(h.runPromiseDetached).not.toHaveBeenCalled()
  })

  it('清设置失败也交给 runPromiseDetached（不吞、不阻断）', async () => {
    const failure = new Error('clear failed')
    const h = harness({
      draft: '',
      setSkill: vi.fn(async () => {
        throw failure
      }),
    })
    const { update } = render(h.input)

    update({ ...h.input, draft: `写个方案 ${chip()}` })
    update({ ...h.input, draft: '写个方案' })

    const work = h.runPromiseDetached.mock.calls[0]![0] as Promise<unknown>
    await expect(work).rejects.toBe(failure)
  })
})
