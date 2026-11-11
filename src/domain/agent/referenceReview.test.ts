import { describe, expect, it } from 'vitest'
import type { ReferenceItem } from '../project/referenceLedger'
import {
  ambiguousReferenceIds,
  looksLikeImageWork,
  nextReferenceReview,
  normalizeReferenceReview,
  referenceConstraintsForTurn,
  referenceReviewPrompt,
  sidebarReferencesToAnalyze,
  textAssignsReferenceRoles,
  type ReviewedReference,
} from './referenceReview'

const item = (id: string, patch: Partial<ReferenceItem> = {}): ReferenceItem => ({
  id,
  projectId: 'p1',
  title: `${id}.jpg`,
  source: 'file',
  kind: 'image',
  assetHash: `hash-${id}`,
  what: `${id} 画面`,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

const row = (itemId: string, patch: Partial<ReviewedReference> = {}): ReviewedReference => ({
  itemId,
  usage: 'style',
  roleClear: true,
  relevant: true,
  ...patch,
})

describe('sidebarReferencesToAnalyze', () => {
  const omitted = [
    { item: item('a'), reason: 'no_usage' },
    { item: item('b'), reason: 'no_usage' },
    { item: item('c'), reason: 'avoid' },
    { item: item('t', { kind: 'text', assetHash: undefined }), reason: 'no_usage' },
  ]

  it('只挑当前任务无用法、有图、未尝试过、未显式提到的侧栏图', () => {
    expect(sidebarReferencesToAnalyze({
      omitted, mentionedIds: [], review: { analyzedIds: [], pendingIds: [] }, enabled: true,
    })).toEqual(['a', 'b'])
    expect(sidebarReferencesToAnalyze({
      omitted, mentionedIds: ['a'], review: { analyzedIds: ['b'], pendingIds: [] }, enabled: true,
    })).toEqual([])
  })

  it('闸门关闭（闲聊 / 回答问题卡 / 内部续跑）时不分析', () => {
    expect(sidebarReferencesToAnalyze({
      omitted, mentionedIds: [], review: { analyzedIds: [], pendingIds: [] }, enabled: false,
    })).toEqual([])
  })

  it('一次最多 6 张，避免首轮串行调用过多', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ item: item(`i${index}`), reason: 'no_usage' }))
    expect(sidebarReferencesToAnalyze({
      omitted: many, mentionedIds: [], review: { analyzedIds: [], pendingIds: [] }, enabled: true,
    })).toHaveLength(6)
  })
})

describe('ambiguousReferenceIds', () => {
  it('单张图分析清楚 → 不问', () => {
    expect(ambiguousReferenceIds({ reviewed: [row('a', { usage: 'subject' })], failedIds: [], text: '做海报' })).toEqual([])
  })

  it('产品白底图 + 氛围海报（分工清楚）→ 不问', () => {
    expect(ambiguousReferenceIds({
      reviewed: [row('cup', { usage: 'subject' }), row('mood', { usage: 'style' })],
      failedIds: [],
      text: '用这两张做一张新品海报',
    })).toEqual([])
  })

  it('模型判断不出角色（roleClear=false）→ 问；单张也问', () => {
    expect(ambiguousReferenceIds({ reviewed: [row('a', { roleClear: false })], failedIds: [], text: '做海报' })).toEqual(['a'])
  })

  it('两张都像主体 / 都像版式 → 问；用户原话逐张点明分工时不问', () => {
    const reviewed = [row('a', { usage: 'subject' }), row('b', { usage: 'subject' }), row('c', { usage: 'style' })]
    expect(ambiguousReferenceIds({ reviewed, failedIds: [], text: '做一张海报' })).toEqual(['a', 'b'])
    expect(ambiguousReferenceIds({ reviewed, failedIds: [], text: '图1做主体，图2只借配色' })).toEqual([])
  })

  it('无关图与用户已确认的图不参与判定', () => {
    expect(ambiguousReferenceIds({
      reviewed: [
        row('a', { roleClear: false, relevant: false }),
        row('b', { usage: 'subject', confirmedByUser: true }),
        row('c', { usage: 'subject' }),
      ],
      failedIds: [],
      text: '做海报',
    })).toEqual([])
  })

  it('分析失败 ≥2 张 → 退回问（不瞎猜）；只失败 1 张不问', () => {
    expect(ambiguousReferenceIds({ reviewed: [], failedIds: ['a', 'b'], text: '做海报' })).toEqual(['a', 'b'])
    expect(ambiguousReferenceIds({ reviewed: [], failedIds: ['a'], text: '做海报' })).toEqual([])
  })
})

describe('nextReferenceReview / normalizeReferenceReview', () => {
  it('累加已尝试、待确认，已回答的移出', () => {
    const first = nextReferenceReview(undefined, { attemptedIds: ['a', 'b'], ambiguousIds: ['a', 'b'] })
    expect(first).toEqual({ analyzedIds: ['a', 'b'], pendingIds: ['a', 'b'] })
    const second = nextReferenceReview(first, { attemptedIds: ['c'], ambiguousIds: [], resolvedIds: ['a', 'b'] })
    expect(second).toEqual({ analyzedIds: ['a', 'b', 'c'], pendingIds: [] })
  })

  it('坏数据归一：非数组 / 非字符串丢弃，全空返回 undefined', () => {
    expect(normalizeReferenceReview({ analyzedIds: ['a', 1, 'a'], pendingIds: 'x' })).toEqual({ analyzedIds: ['a'], pendingIds: [] })
    expect(normalizeReferenceReview({ analyzedIds: [], pendingIds: [] })).toBeUndefined()
    expect(normalizeReferenceReview(null)).toBeUndefined()
  })
})

describe('referenceReviewPrompt', () => {
  it('有待确认图 → 要求 askQuestions 并给出 referenceItemId', () => {
    const prompt = referenceReviewPrompt({ pending: [item('a'), item('b')], clearCount: 0, answeringQuestionCard: false })
    expect(prompt).toContain('askQuestions')
    expect(prompt).toContain('referenceItemId: a')
    expect(prompt).toContain('第 2 张【b.jpg】')
  })

  it('分析清楚 → 直接用，不要发问题卡', () => {
    const prompt = referenceReviewPrompt({ pending: [], clearCount: 2, answeringQuestionCard: false })
    expect(prompt).toContain('不要再为这些图发问题卡')
    expect(prompt).not.toContain('`askQuestions` 发问题卡')
  })

  it('回答问题卡 / 内部续跑 / 无事可说 → 空', () => {
    expect(referenceReviewPrompt({ pending: [item('a')], clearCount: 0, answeringQuestionCard: true })).toBe('')
    expect(referenceReviewPrompt({ pending: [item('a')], clearCount: 0, answeringQuestionCard: false, internalControl: true })).toBe('')
    expect(referenceReviewPrompt({ pending: [], clearCount: 0, answeringQuestionCard: false })).toBe('')
  })
})

describe('意图判定', () => {
  it('looksLikeImageWork：出图 / 改图请求为真，闲聊为假', () => {
    expect(looksLikeImageWork('帮我做一张新品海报')).toBe(true)
    expect(looksLikeImageWork('把标题改成红色')).toBe(true)
    expect(looksLikeImageWork('你好')).toBe(false)
    expect(looksLikeImageWork('今天天气怎么样')).toBe(false)
  })

  it('textAssignsReferenceRoles：逐张点明分工才算', () => {
    expect(textAssignsReferenceRoles('第 2 张锁定产品')).toBe(true)
    expect(textAssignsReferenceRoles('图1做主体，图2参考配色')).toBe(true)
    expect(textAssignsReferenceRoles('用这两张做海报')).toBe(false)
  })
})

describe('G9：用户回答写回', () => {
  it('referenceConstraintsForTurn：问题卡按题关联；未关联时整条回答作用于待确认图', () => {
    expect(referenceConstraintsForTurn({
      answersQuestionCard: true, byQuestion: { a: '锁产品' }, pendingIds: ['a', 'b'], text: '问题卡回答：…',
    })).toEqual({ a: '锁产品' })
    expect(referenceConstraintsForTurn({
      answersQuestionCard: true, byQuestion: {}, pendingIds: ['a', 'b'], text: '第 2 张锁定产品',
    })).toEqual({ a: '第 2 张锁定产品', b: '第 2 张锁定产品' })
  })

  it('没回答问题卡：只有逐张点明分工才算回答；没有待确认图时不写回', () => {
    expect(referenceConstraintsForTurn({
      answersQuestionCard: false, byQuestion: {}, pendingIds: ['a'], text: '图1做主体',
    })).toEqual({ a: '图1做主体' })
    expect(referenceConstraintsForTurn({
      answersQuestionCard: false, byQuestion: {}, pendingIds: ['a'], text: '再大一点',
    })).toEqual({})
    expect(referenceConstraintsForTurn({
      answersQuestionCard: true, byQuestion: {}, pendingIds: [], text: '随便',
    })).toEqual({})
  })

  it('nextReferenceReview：重写失败的回答留作约束，重写成功的移除；normalize 保留 answers', () => {
    const failed = nextReferenceReview(
      { analyzedIds: ['a', 'b'], pendingIds: ['a', 'b'] },
      { attemptedIds: ['a', 'b'], ambiguousIds: [], resolvedIds: ['a', 'b'], fallbackAnswers: { b: '只借配色' }, confirmedIds: ['a'] },
    )
    expect(failed).toEqual({ analyzedIds: ['a', 'b'], pendingIds: [], answers: { b: '只借配色' } })
    expect(normalizeReferenceReview(failed)).toEqual(failed)
    expect(nextReferenceReview(failed, { attemptedIds: [], ambiguousIds: [], confirmedIds: ['b'] }))
      .toEqual({ analyzedIds: ['a', 'b'], pendingIds: [] })
  })

  it('referenceReviewPrompt：回答问题卡的回合也给出「已确认」段，回退项带用户原话', () => {
    const prompt = referenceReviewPrompt({
      pending: [],
      clearCount: 0,
      answeringQuestionCard: true,
      confirmedCount: 1,
      answered: [{ item: item('b'), answer: '只借配色' }],
    })
    expect(prompt).toContain('用户已确认的参考用法（最高优先级）')
    expect(prompt).toContain('1 张参考已按用户的回答重写用法')
    expect(prompt).toContain('【b.jpg】用户回答：只借配色')
    expect(prompt).not.toContain('askQuestions')
  })
})
