import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../shared/execution/types'
import {
  formatQuestionAnswers,
  formatQuestionSkip,
  isQuestionCardSkip,
  parseQuestionCardAnswerMessage,
  QUESTION_CARD_DEFAULT_LEAD,
  stripQuestionCardEcho,
  latestQuestionCard,
  parseQuestionCardArgs,
  questionCardAnswerable,
  questionCardText,
  questionCardTurn,
  questionAnswersByReference,
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
  it('正文只留一句引导，不复述题目与选项（2026-11-12 问题卡 UI）', () => {
    expect(questionCardText('', [size, refs])).toBe(QUESTION_CARD_DEFAULT_LEAD)
    expect(questionCardText('画布上还没有素材，开工前先定 2 件事。', [size, refs])).toBe(
      '画布上还没有素材，开工前先定 2 件事。',
    )
    const echoed = questionCardText(
      '先确认：\n1. 尺寸？（3:4 / 9:16）\n2. 参考图怎么用？\n在下方问题卡里选择或填写后提交，我再接着做。',
      [size, refs],
    )
    expect(echoed).toBe('先确认：')
    expect(echoed).not.toContain('3:4')
  })

  it('投影守卫剥掉与卡片重复的编号清单、选项子行和提交提示，保留其他正文', () => {
    const prose = [
      '画布上没有月饼素材。开工前先定 2 件事，直接影响走向。',
      '1. **尺寸？**（3:4 / 9:16 / 或直接写）',
      '   - 3:4',
      '   - 9:16',
      '2. 参考图怎么用？（可多选）',
      '- 管排版 / 锁产品 / 借配色',
      '在下方问题卡里选择或填写后提交，我再接着做。',
    ].join('\n')
    expect(stripQuestionCardEcho(prose, [size, refs])).toBe('画布上没有月饼素材。开工前先定 2 件事，直接影响走向。')
    const unrelated = '先说结论：\n1. 新茶饮在健康化\n2. 联名周期变短'
    expect(stripQuestionCardEcho(unrelated, [size, refs])).toBe(unrelated)
  })

  it('跳过：逐题写未回答，可被识别；折叠摘要能还原题 → 答', () => {
    const skip = formatQuestionSkip([size, refs])
    expect(isQuestionCardSkip(skip)).toBe(true)
    expect(skip).toContain('1. 尺寸？ → 未回答')
    expect(parseQuestionCardAnswerMessage(skip)).toMatchObject({ skipped: true, answeredCount: 0 })
    const answered = formatQuestionAnswers([size, refs], [
      { questionId: 'size', selected: ['3:4'], freeText: '' },
    ])
    expect(isQuestionCardSkip(answered)).toBe(false)
    expect(parseQuestionCardAnswerMessage(answered)).toEqual({
      skipped: false,
      answeredCount: 1,
      rows: [
        { question: '尺寸？', answer: '3:4' },
        { question: '参考图怎么用？', answer: '未回答' },
      ],
    })
    expect(parseQuestionCardAnswerMessage('随便说一句')).toBeNull()
    // 跳过消息不产生任何 G9 参考约束
    expect(questionAnswersByReference([{ ...refs, referenceItemId: 'ref_1' }], skip)).toEqual({})
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
    expect(ok.text).toBe(QUESTION_CARD_DEFAULT_LEAD)
    const bad = questionCardTurn('c2', { questions: [] })
    expect(bad.text).toBeNull()
    expect(JSON.parse(bad.toolMessage.content)).toMatchObject({ ok: false })
  })
})

describe('G9：问题卡题目关联参考卡', () => {
  it('referenceItemId 被解析并保留；没给时不出现该键', () => {
    const parsed = parseQuestionCardArgs({
      questions: [
        { question: '第 1 张怎么用？', options: ['锁定产品', '借风格'], referenceItemId: 'ref-cup' },
        { question: '合成一张还是各做一张？', options: ['合成一张', '各做一张'] },
      ],
    })
    if (!parsed.ok) throw new Error(parsed.problems.join())
    expect(parsed.questions[0]?.referenceItemId).toBe('ref-cup')
    expect(parsed.questions[1]).not.toHaveProperty('referenceItemId')
  })

  it('questionAnswersByReference：按题号取回答原话，跳过未回答与未关联的题', () => {
    const questions: AgentQuestion[] = [
      { ...refs, id: 'a', question: '第 1 张怎么用？', referenceItemId: 'ref-cup' },
      { ...size, id: 'b' },
      { ...refs, id: 'c', question: '第 2 张怎么用？', referenceItemId: 'ref-mood' },
    ]
    const text = formatQuestionAnswers(questions, [
      { questionId: 'a', selected: ['锁产品'], freeText: '杯盖颜色别变' },
      { questionId: 'b', selected: ['3:4'], freeText: '' },
    ])
    expect(questionAnswersByReference(questions, text)).toEqual({
      'ref-cup': '第 1 张怎么用？ → 锁产品；杯盖颜色别变',
    })
    expect(questionAnswersByReference(questions, '第 2 张锁定产品')).toEqual({})
  })
})
