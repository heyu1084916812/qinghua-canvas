import type { ReferenceItem, ReferenceUsageKind } from '../project/referenceLedger'
import { isQuestionCardSkip } from './questionCard'

/**
 * 参考侧栏的「先分析、拿不准才问」（G5 修订，Lovart 对照 review/lovart-qcard-interview.md）。
 *
 * 1. 卡片「Agent 如何参考」对当前任务为空时，先自动跑参考分析补齐（每个任务每张图只尝试一次，
 *    记在 AgentTaskRef.referenceReview.analyzedIds，避免每回合重复调模型）；
 * 2. 只有多张图的分工 / 组合有多种合理可能、无法替用户拍板时才提示发问题卡；
 *    用户在对话里提了图但没说用途也一样：看得出分工就直接用，看不出才问；
 * 3. 已问过、待回答的图记在 pendingIds，回答后移出；新任务（agentTask 判定）从空开始。
 * 4. 用户的回答（问题卡，或在输入框里逐张点明分工）由参考分析结合图片重写该图的完整用法（G9），
 *    写入的用法标记 confirmedByUser；重写失败时把原话留在 answers 里当约束。
 *
 * 「有歧义」的判定（确定性，规则顺序即优先级）：
 * - 分析给出 roleClear=false（模型自己判断不出这张图在本任务里的角色）→ 有歧义；
 * - 本回合新分析、未经用户确认的图里，≥2 张同为 subject（主体）或同为 composition（版式），
 *   且用户原话没有逐张点明分工 → 有歧义（合进一张还是各做一张 / 哪张做主体拿不准）；
 * - 分析失败（或没有分析能力）的图 ≥2 张 → 有歧义（退回旧的 G5 行为，宁可问不瞎猜）。
 * 单张图分析清楚 → 直接用，不问。
 */

export interface ReferenceReviewState {
  /** 本任务已尝试自动分析过的参考（含失败 / 判为无关），同任务不再重复分析。 */
  analyzedIds: string[]
  /** 本任务里判定有歧义、等待问题卡回答的参考。 */
  pendingIds: string[]
  /**
   * G9 回退：用户回答了、但按回答重写用法的分析失败的参考（itemId → 用户原话）。
   * 同任务每回合作为最高优先级约束提示给模型，不再追问。
   */
  answers?: Record<string, string>
}

export interface ReviewedReference {
  itemId: string
  usage: ReferenceUsageKind
  roleClear: boolean
  relevant: boolean
  confirmedByUser?: boolean
}

const AUTO_ANALYSIS_LIMIT = 6
const WHAT_LIMIT = 40

/** 本句像是要出图 / 改图（而不是闲聊、问问题）：只有这时才去分析侧栏里没提到的图。 */
const IMAGE_WORK_PATTERN =
  /做|画|生成|设计|出图|改图|重绘|海报|logo|标志|包装|主图|封面|插画|banner|延展|横版|竖版|再来|换成|改成|配图|详情页|kv/i

/** 用户原话逐张点明了分工（「图 1 做主体、图 2 参考配色」）。 */
const ROLE_ASSIGNMENT_PATTERN =
  /(?:图\s*[一二三四五六七八九\d]|第\s*[一二三四五六七八九\d]\s*张|这张|那张|左边|右边).{0,12}(?:主体|产品|商品|排版|版式|构图|配色|色调|颜色|风格|质感|字体|logo|标志|锁定|借|参考|不用)/i

export function emptyReferenceReview(): ReferenceReviewState {
  return { analyzedIds: [], pendingIds: [] }
}

export function looksLikeImageWork(text: string): boolean {
  return IMAGE_WORK_PATTERN.test(text.replace(/\s+/g, ''))
}

export function textAssignsReferenceRoles(text: string): boolean {
  return ROLE_ASSIGNMENT_PATTERN.test(text.replace(/\s+/g, ''))
}

function hasImageAsset(item: ReferenceItem): boolean {
  return item.kind === 'image' && Boolean(item.assetHash || item.assets?.length)
}

/**
 * 本回合要自动分析的侧栏图：当前任务没有用法、本任务还没尝试过、也不是本轮显式提到的
 * （显式提到的照旧走自动分析，不受本闸门限制）。最多 AUTO_ANALYSIS_LIMIT 张。
 */
export function sidebarReferencesToAnalyze(input: {
  omitted: readonly { item: ReferenceItem; reason: string }[]
  mentionedIds: readonly string[]
  review: ReferenceReviewState
  enabled: boolean
}): string[] {
  if (!input.enabled) return []
  const skip = new Set([...input.mentionedIds, ...input.review.analyzedIds])
  return input.omitted
    .filter((row) => row.reason === 'no_usage' && hasImageAsset(row.item) && !skip.has(row.item.id))
    .map((row) => row.item.id)
    .slice(0, AUTO_ANALYSIS_LIMIT)
}

export function ambiguousReferenceIds(input: {
  reviewed: readonly ReviewedReference[]
  failedIds: readonly string[]
  text: string
}): string[] {
  const open = input.reviewed.filter((row) => row.relevant && row.confirmedByUser !== true)
  const ambiguous = new Set(open.filter((row) => !row.roleClear).map((row) => row.itemId))
  if (!textAssignsReferenceRoles(input.text)) {
    for (const slot of ['subject', 'composition'] as const) {
      const rows = open.filter((row) => row.usage === slot)
      if (rows.length >= 2) rows.forEach((row) => ambiguous.add(row.itemId))
    }
  }
  if (input.failedIds.length >= 2) input.failedIds.forEach((id) => ambiguous.add(id))
  return [...ambiguous]
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

/** 合并本回合的分析结果进任务状态。resolvedIds = 本回合已得到用户回答的参考。 */
export function nextReferenceReview(
  previous: ReferenceReviewState | undefined,
  update: {
    attemptedIds: readonly string[]
    ambiguousIds: readonly string[]
    resolvedIds?: readonly string[]
    /** 本回合用户回答但重写失败的参考（原话）；重写成功的应从 answers 里去掉（confirmedIds）。 */
    fallbackAnswers?: Readonly<Record<string, string>>
    confirmedIds?: readonly string[]
  },
): ReferenceReviewState {
  const base = previous ?? emptyReferenceReview()
  const resolved = new Set(update.resolvedIds ?? [])
  const answers: Record<string, string> = { ...(base.answers ?? {}), ...(update.fallbackAnswers ?? {}) }
  for (const id of update.confirmedIds ?? []) delete answers[id]
  return {
    analyzedIds: unique([...base.analyzedIds, ...update.attemptedIds]),
    pendingIds: unique([...base.pendingIds, ...update.ambiguousIds]).filter((id) => !resolved.has(id)),
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
  }
}

/**
 * G9：本回合要按用户回答重写用法的参考（itemId → 回答原话）。
 * - 回答问题卡：优先按题目的 referenceItemId 对应；题目没标 id 时，整条回答作用于所有待确认的图；
 * - 没回答问题卡、但有待确认的图且用户在输入框里逐张点明了分工：整句作用于所有待确认的图。
 */
export function referenceConstraintsForTurn(input: {
  answersQuestionCard: boolean
  byQuestion: Readonly<Record<string, string>>
  pendingIds: readonly string[]
  text: string
}): Record<string, string> {
  // 「跳过」= 按推断继续：不把跳过这句话当成任何参考的用法约束（2026-11-12 问题卡 UI）。
  if (input.answersQuestionCard && isQuestionCardSkip(input.text)) return {}
  if (input.answersQuestionCard && Object.keys(input.byQuestion).length > 0) return { ...input.byQuestion }
  const text = input.text.trim()
  if (!text || input.pendingIds.length === 0) return {}
  if (!input.answersQuestionCard && !textAssignsReferenceRoles(text)) return {}
  return Object.fromEntries(input.pendingIds.map((id) => [id, text]))
}

export function normalizeReferenceReview(value: unknown): ReferenceReviewState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  const ids = (raw: unknown) =>
    Array.isArray(raw) ? unique(raw.filter((id): id is string => typeof id === 'string')) : []
  const answers = row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
    ? Object.fromEntries(Object.entries(row.answers as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
        .map(([id, text]) => [id, text.slice(0, 500)]))
    : {}
  const review: ReferenceReviewState = {
    analyzedIds: ids(row.analyzedIds),
    pendingIds: ids(row.pendingIds),
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
  }
  return review.analyzedIds.length > 0 || review.pendingIds.length > 0 || review.answers ? review : undefined
}

/**
 * 回合上下文段落：
 * - 有待确认的图 → 要求发问题卡，每题用 referenceItemId 指明问的是哪张；
 * - 本回合自动分析清楚 → 告诉模型直接按已写入的用法用，不要再为它们发问题卡。
 */
export function referenceReviewPrompt(input: {
  pending: readonly ReferenceItem[]
  clearCount: number
  answeringQuestionCard: boolean
  internalControl?: boolean
  /** G9：本回合已按用户回答重写用法的参考数。 */
  confirmedCount?: number
  /** G9 回退：重写失败、只能把用户原话当约束的参考。 */
  answered?: readonly { item: ReferenceItem; answer: string }[]
}): string {
  const confirmed = confirmedSection(input.confirmedCount ?? 0, input.answered ?? [])
  if (input.answeringQuestionCard || input.internalControl) return confirmed
  const open = openSection(input)
  return [confirmed, open].filter(Boolean).join('\n\n')
}

function confirmedSection(
  confirmedCount: number,
  answered: readonly { item: ReferenceItem; answer: string }[],
): string {
  const lines: string[] = []
  if (confirmedCount > 0) {
    lines.push(`${confirmedCount} 张参考已按用户的回答重写用法（见上方参考段落），以它为准执行，不要再为这些图发问题卡。`)
  }
  if (answered.length > 0) {
    lines.push('下列参考按回答重写用法没有成功，用户原话就是最高优先级约束，照它使用、不要与之矛盾、也不要再问：')
    for (const row of answered.slice(0, 8)) {
      lines.push(`- 【${row.item.title.trim() || row.item.id}】用户回答：${row.answer.replace(/\s+/g, ' ').trim().slice(0, 200)}`)
    }
  }
  return lines.length > 0 ? ['## 用户已确认的参考用法（最高优先级）', ...lines].join('\n') : ''
}

function openSection(input: { pending: readonly ReferenceItem[]; clearCount: number }): string {
  if (input.pending.length > 0) {
    const lines = input.pending.slice(0, 8).map((item, index) => {
      const what = item.what.replace(/\s+/g, ' ').trim().slice(0, WHAT_LIMIT)
      return `- 第 ${index + 1} 张【${item.title.trim() || item.id}】（referenceItemId: ${item.id}）${what ? `：${what}` : ''}`
    })
    return [
      '## 参考图的分工拿不准，先问用户',
      `参考栏有 ${input.pending.length} 张图，自动分析后仍判断不出它们在本任务里怎么配合：`,
      ...lines,
      '本次要出图 / 改图时：先调用 `askQuestions` 发问题卡，每张图一题并把该题的 `referenceItemId` 填成上面的 id，',
      '问这张图怎么用（候选项如「管排版」「锁定产品 / 主体」「只借配色」「借风格」「不用」），也可加一题问合成一张还是各做一张；',
      '本回合不要生成。与任务明显无关（闲聊、纯画布操作）时忽略本段。',
    ].join('\n')
  }
  if (input.clearCount > 0) {
    return [
      '## 参考图已自动分析',
      `参考栏里 ${input.clearCount} 张图已按本任务分析并写入用法（见上方参考段落），分工清楚：`,
      '直接按用法使用，不要再为这些图发问题卡。',
    ].join('\n')
  }
  return ''
}
