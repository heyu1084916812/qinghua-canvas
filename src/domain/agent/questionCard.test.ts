import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../shared/execution/types'
import {
  formatQuestionAnswers,
  latestQuestionCard,
  parseQuestionCardArgs,
  questionCardAnswerable,
  questionCardText,
  questionCardTurn,
  setQuestionFreeText,
  toggleQuestionOption,
  type AgentQuestion,
} from './questionCard'

const size: AgentQuestion = {
  id: 'size',
  question: '尺寸？',
  options: ['3:4', '9:16'],
  multiple: false,
  allowFreeText: true,
}
const refs: AgentQuestion = {
  id: 'refs',
  question: '参考图怎么用？',
  options: ['管排版', '锁产品', '借配色'],
  multiple: true,
  allowFreeText: false,
}

describe('parseQuestionCardArgs', () => {
  it('整理题目：裁空白、去重选项、补 id、缺省单选 + 自由输入', () => {
    const parsed = parseQuestionCardArgs({
      intro: '  先问两句 ',
      questions: [
        { question: ' 尺寸？ ', options: ['3:4', '3:4', ' 9:16 ', ''] },
        { id: 'refs', question: '参考？', options: ['A'], multiple: true },
      ],
    })
    expect(parsed).toEqual({
      ok: true,
      intro: '先问两句',
      questions: [
        { id: 'q1', question: '尺寸？', options: ['3:4', '9:16'], multiple: false, allowFreeText: true },
        { id: 'refs', question: '参考？', options: ['A'], multiple: true, allowFreeText: true },
      ],
    })
  })

  it('空题、超过 4 题、既无选项又禁止自由输入 → 报问题', () => {
    expect(parseQuestionCardArgs({ questions: [] }).ok).toBe(false)
    const tooMany = parseQuestionCardArgs({
      questions: Array.from({ length: 5 }, (_, i) => ({ question: `q${i}` })),
    })
    expect(tooMany.ok).toBe(false)
    const dead = parseQuestionCardArgs({ questions: [{ question: 'x', allowFreeText: false }] })
    expect(dead.ok).toBe(false)
    if (!dead.ok) expect(dead.problems[0]).toContain('无法回答')
  })

  it('重复 id 自动加后缀，避免两题共用答案', () => {
    const parsed = parseQuestionCardArgs({
      questions: [{ id: 'a', question: 'x' }, { id: 'a', question: 'y' }],
    })
    expect(parsed.ok && parsed.questions.map((q) => q.id)).toEqual(['a', 'a-2'])
  })
})

describe('问题卡兜底文案与回答整理', () => {
  it('兜底正文列出题目与选项，不渲染问题卡的环境也能看懂', () => {
    const text = questionCardText('', [size, refs])
    expect(text).toContain('开始之前')
    expect(text).toContain('1. 尺寸？（3:4 / 9:16 / 或直接写）')
    expect(text).toContain('2. 参考图怎么用？（管排版 / 锁产品 / 借配色）')
  })

  it('单选再点取消、点别的替换；多选按选项原顺序', () => {
    let answers = toggleQuestionOption([], size, '3:4')
    answers = toggleQuestionOption(answers, size, '9:16')
    expect(answers.find((a) => a.questionId === 'size')?.selected).toEqual(['9:16'])
    answers = toggleQuestionOption(answers, size, '9:16')
    expect(answers.find((a) => a.questionId === 'size')?.selected).toEqual([])
    answers = toggleQuestionOption(answers, refs, '借配色')
    answers = toggleQuestionOption(answers, refs, '管排版')
    expect(answers.find((a) => a.questionId === 'refs')?.selected).toEqual(['管排版', '借配色'])
    expect(toggleQuestionOption(answers, refs, '不存在')).toEqual(answers)
  })

  it('自由输入只对允许的题生效；有任一回答才可提交', () => {
    expect(questionCardAnswerable([size, refs], [])).toBe(false)
    expect(setQuestionFreeText([], refs, 'x')).toEqual([])
    const answers = setQuestionFreeText([], size, '  1080x1440 ')
    expect(questionCardAnswerable([size, refs], answers)).toBe(true)
    expect(questionCardAnswerable([size], setQuestionFreeText([], size, '   '))).toBe(false)
  })

  it('整理成一条用户消息：选项 + 自由输入，没答的写未回答', () => {
    let answers = toggleQuestionOption([], size, '3:4')
    answers = setQuestionFreeText(answers, size, '小红书')
    expect(formatQuestionAnswers([size, refs], answers)).toBe(
      '问题卡回答：\n1. 尺寸？ → 3:4；小红书\n2. 参考图怎么用？ → 未回答',
    )
  })
})

describe('latestQuestionCard', () => {
  const card = { ok: true, awaitingAnswers: true, questions: [size] }
  const asked: ChatMessage[] = [
    { role: 'user', content: '做海报' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'q', name: 'askQuestions', args: '{}' }] },
    { role: 'tool', toolCallId: 'q', toolName: 'askQuestions', content: JSON.stringify(card) },
    { role: 'assistant', content: '先问一下' },
  ]

  it('最后一张问题卡之后没有用户消息 → 未回答', () => {
    expect(latestQuestionCard(asked)).toMatchObject({ callId: 'q', answered: false })
  })

  it('之后有用户消息 → 已回答；失败的卡与没有卡 → null', () => {
    expect(latestQuestionCard([...asked, { role: 'user', content: '3:4' }])?.answered).toBe(true)
    expect(
      latestQuestionCard([
        { role: 'tool', toolName: 'askQuestions', toolCallId: 'x', content: '{"ok":false}' },
      ]),
    ).toBeNull()
    expect(latestQuestionCard([{ role: 'user', content: 'hi' }])).toBeNull()
  })
})

describe('questionCardTurn', () => {
  it('合法 → 工具结果 awaitingAnswers + 正文；不合法 → 问题回填、正文为 null', () => {
    const ok = questionCardTurn('c1', { questions: [{ question: '尺寸？', options: ['3:4'] }] })
    expect(ok.toolMessage).toMatchObject({ role: 'tool', toolCallId: 'c1', toolName: 'askQuestions' })
    expect(JSON.parse(ok.toolMessage.content)).toMatchObject({ ok: true, awaitingAnswers: true })
    expect(ok.text).toContain('1. 尺寸？（3:4 / 或直接写）')
    const bad = questionCardTurn('c2', { questions: [] })
    expect(bad.text).toBeNull()
    expect(JSON.parse(bad.toolMessage.content)).toMatchObject({ ok: false })
  })
})

