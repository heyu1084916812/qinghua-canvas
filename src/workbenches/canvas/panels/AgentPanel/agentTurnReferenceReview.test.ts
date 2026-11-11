import { describe, expect, it, vi } from 'vitest'
import type { AgentTaskRef } from '../../../../domain/agent/agentTask'
import type { ReferenceCurationResult } from '../../../../domain/project/referenceCuration'
import type { ReferenceItem, ReferenceSelection } from '../../../../domain/project/referenceLedger'
import { reviewTurnReferences, type TurnReferenceReviewInput } from './agentTurnReferenceReview'

const item = (id: string): ReferenceItem => ({
  id,
  projectId: 'p1',
  title: `${id}.jpg`,
  source: 'file',
  kind: 'image',
  assetHash: `hash-${id}`,
  what: `${id} 画面`,
  createdAt: 1,
  updatedAt: 1,
})

const task = (patch: Partial<AgentTaskRef> = {}): AgentTaskRef => ({
  id: 't1',
  brief: '',
  startedAt: 1,
  updatedAt: 1,
  turns: 1,
  referenceIds: [],
  ...patch,
})

const selection = (ids: string[]): ReferenceSelection => ({
  selected: [],
  omitted: ids.map((id) => ({ item: item(id), reason: 'no_usage' as const })),
})

function curation(analyzed: Partial<ReferenceCurationResult['analyzed'][number]>[]): ReferenceCurationResult {
  return {
    ok: true,
    summary: '',
    taskKey: 'task:t1',
    analyzed: analyzed.map((row) => ({
      itemId: 'x',
      title: 'x',
      what: 'x',
      usage: 'style',
      howToUse: '借：x；避：y',
      roleClear: true,
      relevant: true,
      ...row,
    })),
    failed: [],
    limitations: [],
  }
}

function input(patch: Partial<TurnReferenceReviewInput>): TurnReferenceReviewInput {
  return {
    task: task(),
    text: '帮我做一张新品海报',
    requestMode: 'simple_generate',
    internalControl: false,
    answersQuestionCard: false,
    selectForTask: async () => selection(['cup', 'mood']),
    ...patch,
  }
}

describe('reviewTurnReferences（G5 修订：先分析，拿不准才问）', () => {
  it('侧栏无用法的图先自动分析；分工清楚 → 不进待确认，记为已分析', async () => {
    const curate = vi.fn(async () => curation([
      { itemId: 'cup', usage: 'subject' },
      { itemId: 'mood', usage: 'style' },
    ]))
    const result = await reviewTurnReferences(input({ curate }))
    expect(curate).toHaveBeenCalledWith({ itemIds: ['cup', 'mood'], explicitItemIds: [] })
    expect(result.pendingIds).toEqual([])
    expect(result.clearCount).toBe(2)
    expect(result.task.referenceReview).toEqual({ analyzedIds: ['cup', 'mood'], pendingIds: [] })
  })

  it('两张都像主体 → 待确认；同任务下一回合不再重复分析', async () => {
    const curate = vi.fn(async () => curation([
      { itemId: 'cup', usage: 'subject' },
      { itemId: 'mood', usage: 'subject' },
    ]))
    const first = await reviewTurnReferences(input({ curate }))
    expect(first.pendingIds).toEqual(['cup', 'mood'])
    curate.mockClear()
    const second = await reviewTurnReferences(input({ curate, task: first.task, text: '再做一张' }))
    expect(curate).not.toHaveBeenCalled()
    expect(second.pendingIds).toEqual(['cup', 'mood'])
  })

  it('回答问题卡的回合：不分析侧栏，先前待确认的移出', async () => {
    const curate = vi.fn(async () => curation([]))
    const result = await reviewTurnReferences(input({
      curate,
      answersQuestionCard: true,
      task: task({ referenceReview: { analyzedIds: ['cup', 'mood'], pendingIds: ['cup', 'mood'] } }),
      selectForTask: async () => selection(['new']),
    }))
    expect(curate).not.toHaveBeenCalled()
    expect(result.pendingIds).toEqual([])
  })

  it('闲聊 / 画布操作不分析侧栏图（不白调模型）', async () => {
    const curate = vi.fn(async () => curation([]))
    await reviewTurnReferences(input({ curate, text: '你好' }))
    await reviewTurnReferences(input({ curate, requestMode: 'canvas_operation', text: '把这些图排成一排' }))
    expect(curate).not.toHaveBeenCalled()
  })

  it('用户提了图但没说用途：显式参考也走分析，看不出（roleClear=false）就待确认', async () => {
    const curate = vi.fn(async () => curation([{ itemId: 'a', roleClear: false }]))
    const result = await reviewTurnReferences(input({
      curate,
      task: task({ referenceIds: ['a'] }),
      selectForTask: async () => selection([]),
    }))
    expect(curate).toHaveBeenCalledWith({ itemIds: ['a'], explicitItemIds: ['a'] })
    expect(result.pendingIds).toEqual(['a'])
  })

  it('没有分析能力：≥2 张侧栏图退回待确认（旧 G5 行为）', async () => {
    const result = await reviewTurnReferences(input({}))
    expect(result.pendingIds).toEqual(['cup', 'mood'])
  })

  it('分析抛错：给出警告，侧栏图按失败处理', async () => {
    const result = await reviewTurnReferences(input({
      curate: async () => {
        throw new Error('上游 502')
      },
    }))
    expect(result.warnings.join('\n')).toContain('上游 502')
    expect(result.failedCount).toBe(2)
    expect(result.pendingIds).toEqual(['cup', 'mood'])
  })
})
