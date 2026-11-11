import type { AgentTaskRef } from '../../../../domain/agent/agentTask'
import {
  ambiguousReferenceIds,
  looksLikeImageWork,
  nextReferenceReview,
  sidebarReferencesToAnalyze,
  type ReviewedReference,
} from '../../../../domain/agent/referenceReview'
import type { ReferenceCurationResult } from '../../../../domain/project/referenceCuration'
import type { ReferenceSelection } from '../../../../domain/project/referenceLedger'
import type { AgentRequestMode } from '../../agent/agentContextPolicy'
import { errText } from '../../agent/agentLoop'

/**
 * 回合准备阶段的参考审阅（G5 修订）：显式提到的参考 + 侧栏里当前任务还没有用法的图，
 * 先跑一次参考分析补齐用法，再按 referenceReview.ts 的规则判定哪些图分工拿不准、需要发问题卡。
 *
 * 调模型的次数受两道闸：已有用法的不分析（runAgentReferenceCuration 自己跳过）；
 * 本任务尝试过的侧栏图记进 task.referenceReview.analyzedIds，同任务不再分析。
 */
export interface TurnReferenceReviewInput {
  task: AgentTaskRef
  text: string
  requestMode: AgentRequestMode
  internalControl: boolean
  answersQuestionCard: boolean
  selectForTask?: () => Promise<ReferenceSelection>
  curate?: (args: {
    itemIds: readonly string[]
    explicitItemIds: readonly string[]
  }) => Promise<ReferenceCurationResult>
}

export interface TurnReferenceReview {
  task: AgentTaskRef
  warnings: string[]
  failedCount: number
  /** 本回合分析清楚、可以直接用的参考数。 */
  clearCount: number
  /** 本任务仍待用户确认分工的参考。 */
  pendingIds: string[]
}

export async function reviewTurnReferences(
  input: TurnReferenceReviewInput,
): Promise<TurnReferenceReview> {
  const explicitIds = input.task.referenceIds
  const previous = input.task.referenceReview
  const selection = input.selectForTask
    ? await input.selectForTask().catch(() => null)
    : null
  const sidebarIds = sidebarReferencesToAnalyze({
    omitted: selection?.omitted ?? [],
    mentionedIds: explicitIds,
    review: previous ?? { analyzedIds: [], pendingIds: [] },
    enabled:
      !input.internalControl &&
      !input.answersQuestionCard &&
      input.requestMode !== 'canvas_operation' &&
      looksLikeImageWork(input.text),
  })
  const itemIds = [...new Set([...explicitIds, ...sidebarIds])]
  const warnings: string[] = []
  let reviewed: ReviewedReference[] = []
  let failedIds: string[] = []
  let failedCount = 0
  let attemptedIds: string[] = []
  if (itemIds.length > 0 && input.curate) {
    try {
      const curation = await input.curate({ itemIds, explicitItemIds: explicitIds })
      reviewed = curation.analyzed.map((row) => ({
        itemId: row.itemId,
        usage: row.usage,
        roleClear: row.roleClear !== false,
        relevant: row.relevant !== false,
      }))
      failedIds = curation.failed.map((row) => row.itemId)
      failedCount = curation.failed.length
      attemptedIds = [...reviewed.map((row) => row.itemId), ...failedIds]
      warnings.push(
        ...curation.failed.map((row) => `参考「${row.title}」自动分析失败：${row.reason}`),
        ...curation.limitations,
      )
    } catch (error) {
      warnings.push(`参考自动分析未完成：${errText(error)}`)
      failedIds = sidebarIds
      attemptedIds = sidebarIds
      failedCount = Math.max(1, sidebarIds.length)
    }
  } else if (sidebarIds.length > 0) {
    // 没有分析能力：退回「看不出就问」，侧栏图按分析失败处理。
    failedIds = sidebarIds
    attemptedIds = sidebarIds
  }
  const ambiguousIds = ambiguousReferenceIds({ reviewed, failedIds, text: input.text })
  const review = nextReferenceReview(previous, {
    attemptedIds,
    ambiguousIds,
    // 回答问题卡的回合：先前待确认的图视为已答，不再追问。
    resolvedIds: input.answersQuestionCard ? previous?.pendingIds ?? [] : [],
  })
  const ambiguous = new Set(ambiguousIds)
  const task: AgentTaskRef = { ...input.task }
  if (review.analyzedIds.length > 0 || review.pendingIds.length > 0) task.referenceReview = review
  else delete task.referenceReview
  return {
    task,
    warnings,
    failedCount,
    clearCount: reviewed.filter((row) => row.relevant && row.roleClear && !ambiguous.has(row.itemId)).length,
    pendingIds: review.pendingIds,
  }
}
