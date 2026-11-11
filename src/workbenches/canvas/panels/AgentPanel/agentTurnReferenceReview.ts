import type { AgentTaskRef } from '../../../../domain/agent/agentTask'
import {
  ambiguousReferenceIds,
  looksLikeImageWork,
  nextReferenceReview,
  referenceConstraintsForTurn,
  sidebarReferencesToAnalyze,
  type ReviewedReference,
} from '../../../../domain/agent/referenceReview'
import { questionAnswersByReference, type AgentQuestion } from '../../../../domain/agent/questionCard'
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
  /** 本回合正在回答的问题卡的题目（G9：按 referenceItemId 把回答写回对应参考）。 */
  questionCard?: readonly AgentQuestion[]
  selectForTask?: () => Promise<ReferenceSelection>
  curate?: (args: {
    itemIds: readonly string[]
    explicitItemIds: readonly string[]
    userConstraints?: Readonly<Record<string, string>>
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
  /** G9：本回合已按用户回答重写用法的参考。 */
  confirmedIds: string[]
  /** G9 回退：重写失败、以用户原话为约束的参考（本任务累计）。 */
  answers: Record<string, string>
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
  // G9：用户的回答交给参考分析结合图片重写完整用法，回答本身只是最高优先级约束。
  const constraints = referenceConstraintsForTurn({
    answersQuestionCard: input.answersQuestionCard,
    byQuestion: input.questionCard ? questionAnswersByReference(input.questionCard, input.text) : {},
    pendingIds: previous?.pendingIds ?? [],
    text: input.text,
  })
  const constraintIds = Object.keys(constraints)
  const itemIds = [...new Set([...constraintIds, ...explicitIds, ...sidebarIds])]
  const warnings: string[] = []
  let reviewed: ReviewedReference[] = []
  let failedIds: string[] = []
  let failedCount = 0
  let attemptedIds: string[] = []
  if (itemIds.length > 0 && input.curate) {
    try {
      const curation = await input.curate({
        itemIds,
        explicitItemIds: explicitIds,
        ...(constraintIds.length > 0 ? { userConstraints: constraints } : {}),
      })
      reviewed = curation.analyzed.map((row) => ({
        itemId: row.itemId,
        usage: row.usage,
        roleClear: row.roleClear !== false,
        relevant: row.relevant !== false,
        ...(row.confirmedByUser ? { confirmedByUser: true } : {}),
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
  const confirmedIds = reviewed.filter((row) => row.confirmedByUser === true).map((row) => row.itemId)
  const confirmed = new Set(confirmedIds)
  const constraintSet = new Set(constraintIds)
  // 重写失败（或没有分析能力）的回答：保留用户原话当约束。
  const fallbackAnswers = Object.fromEntries(
    Object.entries(constraints).filter(([id]) => !confirmed.has(id)),
  )
  const ambiguousIds = ambiguousReferenceIds({
    reviewed,
    failedIds: failedIds.filter((id) => !constraintSet.has(id)),
    text: input.text,
  })
  const review = nextReferenceReview(previous, {
    attemptedIds,
    ambiguousIds,
    // 回答问题卡的回合：先前待确认的图视为已答，不再追问；按回答写回的图同样移出。
    resolvedIds: [
      ...constraintIds,
      ...(input.answersQuestionCard ? previous?.pendingIds ?? [] : []),
    ],
    fallbackAnswers,
    confirmedIds,
  })
  const ambiguous = new Set(ambiguousIds)
  const task: AgentTaskRef = { ...input.task }
  if (review.analyzedIds.length > 0 || review.pendingIds.length > 0 || review.answers) {
    task.referenceReview = review
  }
  else delete task.referenceReview
  return {
    task,
    warnings,
    failedCount,
    clearCount: reviewed.filter((row) =>
      row.relevant && row.roleClear && !row.confirmedByUser && !ambiguous.has(row.itemId)).length,
    pendingIds: review.pendingIds,
    confirmedIds,
    answers: review.answers ?? {},
  }
}
