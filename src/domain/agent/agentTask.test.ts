import { describe, expect, it } from 'vitest'
import {
  classifyAgentTaskTurn,
  normalizeAgentTaskRef,
  referenceTaskKey,
  resolveAgentTask,
  type AgentTaskRef,
} from './agentTask'

const previous: AgentTaskRef = {
  id: 'task_a',
  brief: '帮我做一张咖啡店海报',
  startedAt: 1,
  updatedAt: 1,
  turns: 1,
  referenceIds: ['ref_logo'],
}

const env = (id = 'task_b') => ({ now: 10, newId: () => id })

describe('agentTask 延续 vs 新任务', () => {
  it('会话第一句开新任务，并记下截短的 brief', () => {
    const decision = resolveAgentTask(undefined, { text: '帮我做一张咖啡店海报' }, env('task_new'))
    expect(decision).toMatchObject({
      continued: false,
      reason: 'first',
      task: { id: 'task_new', brief: '帮我做一张咖啡店海报', startedAt: 10, turns: 1 },
    })
  })

  it.each([
    ['logo 再大一点', 'refinement'],
    ['换个配色再来一张', 'series'],
    ['再出一张横版的', 'series'],
    ['做同系列的第二张海报', 'series'],
    ['背景保持不变，只把标题改成红色', 'refinement'],
    ['把刚才那张的光线调暗', 'refinement'],
    ['去掉右下角的字', 'refinement'],
    ['这个配色怎么样？', 'follow_up'],
    ['继续', 'continuation'],
  ])('同一任务的后续：「%s」→ %s，沿用 task id', (text, reason) => {
    const decision = resolveAgentTask(previous, { text }, env())
    expect(decision.reason).toBe(reason)
    expect(decision.continued).toBe(true)
    expect(decision.task.id).toBe('task_a')
    expect(decision.task.turns).toBe(2)
    expect(decision.task.brief).toBe(previous.brief)
  })

  it.each([
    ['帮我设计一个奶茶店的 Logo', 'new_request'],
    ['画一只在月球上的猫', 'new_request'],
    ['我想要一套健身房的海报，不要太花', 'new_request'],
    ['换个需求：做一个电商主图', 'explicit_new'],
    ['不做这个了，重新开始', 'explicit_new'],
  ])('换无关新需求：「%s」→ %s，开新 task id', (text, reason) => {
    const decision = resolveAgentTask(previous, { text }, env('task_b'))
    expect(decision.reason).toBe(reason)
    expect(decision.continued).toBe(false)
    expect(decision.task.id).toBe('task_b')
  })

  it('确认卡 / 检查点 / 进行中计划 / 回答问题卡都算延续，哪怕句子像新请求', () => {
    const text = '帮我做一张新海报'
    for (const signal of [
      { hasPendingConfirmation: true },
      { hasActiveContinuation: true },
      { hasActiveTaskPlan: true },
      { answersQuestionCard: true },
    ]) {
      expect(classifyAgentTaskTurn(true, { text, ...signal })).toBe('continuation')
    }
  })

  it('明说换需求优先于进行中的计划', () => {
    expect(
      classifyAgentTaskTurn(true, { text: '换个任务，做个视频', hasActiveTaskPlan: true }),
    ).toBe('explicit_new')
  })

  it('@ / 选中画布图片且没有新需求句式时延续；内部控制回合不累加 turns', () => {
    expect(classifyAgentTaskTurn(true, { text: '用它出视频', refersToCanvasImage: true }))
      .toBe('canvas_image')
    const internal = resolveAgentTask(previous, { text: '继续', internalControl: true }, env())
    expect(internal.task.turns).toBe(1)
  })

  it('同一任务沿用已带过的参考；新任务只认本轮 @ 的参考', () => {
    const same = resolveAgentTask(
      previous,
      { text: '再来一张', referenceIds: ['ref_product'] },
      env(),
    )
    expect(same.task.referenceIds).toEqual(['ref_product', 'ref_logo'])
    const fresh = resolveAgentTask(
      previous,
      { text: '帮我设计一个奶茶店的 Logo', referenceIds: ['ref_cup'] },
      env('task_c'),
    )
    expect(fresh.task.referenceIds).toEqual(['ref_cup'])
    const unrelated = resolveAgentTask(previous, { text: '画一只猫' }, env('task_d'))
    expect(unrelated.task.referenceIds).toEqual([])
  })

  it('taskKey 按任务 id，而不是请求模式', () => {
    expect(referenceTaskKey(previous)).toBe('task:task_a')
  })

  it('normalize 容忍旧数据 / 坏数据', () => {
    expect(normalizeAgentTaskRef(null)).toBeUndefined()
    expect(normalizeAgentTaskRef({ id: '' })).toBeUndefined()
    expect(normalizeAgentTaskRef({ id: 't', startedAt: 5 })).toEqual({
      id: 't',
      brief: '',
      startedAt: 5,
      updatedAt: 5,
      turns: 1,
      referenceIds: [],
    })
  })
})

describe('AgentTaskRef.seriesStage', () => {
  it('normalize 保留合法阶段、丢弃未知值；延续任务继承阶段，新任务不继承', async () => {
    const { normalizeAgentTaskRef, resolveAgentTask } = await import('./agentTask')
    const base = { id: 't1', brief: '', startedAt: 1, updatedAt: 1, turns: 1, referenceIds: [] }
    expect(normalizeAgentTaskRef({ ...base, seriesStage: 'logo_first' })?.seriesStage).toBe('logo_first')
    expect(normalizeAgentTaskRef({ ...base, seriesStage: 'x' })).not.toHaveProperty('seriesStage')
    const previous = { ...base, seriesStage: 'logo_first' as const }
    const env = { now: 2, newId: () => 't2' }
    expect(resolveAgentTask(previous, { text: '再大一点' }, env).task.seriesStage).toBe('logo_first')
    expect(resolveAgentTask(previous, { text: '画一只猫' }, env).task).not.toHaveProperty('seriesStage')
  })
})

