/**
 * Agent 会话里的「任务」标识（参考用法按任务存，而不是按请求模式存）。
 *
 * Lovart 对照（review/lovart-ref-flow-interview.md 问题 6）：
 * - 同一个任务接着往下做（微调、改图、出同系列 / 横版 / 第二张）时，参考图和它的用法自动沿用；
 * - 换了一个新需求时，不把旧任务的用法硬套过去：相关的参考按新任务重新分析，无关的不用。
 *
 * 以前台账的 taskKey 是请求模式（simple_generate / reference_edit …）：同一任务从
 * 「生成」转到「改图」时模式变了，用法反而丢；两个无关任务碰巧同一模式时，旧用法又被套上。
 * 这里把任务做成会话内一个稳定 id，延续还是新开由下面的确定性规则判定，规则顺序即优先级：
 *
 * 1. 会话还没有任务 → 新任务（first）。
 * 2. 用户明说换需求 / 新任务 / 重新开始 → 新任务（explicit_new）。
 * 3. 内部续跑、确认卡、检查点、执行中的计划、回答问题卡 → 延续（continuation）。
 * 4. 系列延展（再来一张、同系列、横版、第二张、延展…）→ 延续（series）。
 * 5. 明确指代上文成品的修改（大一点、保持不变、这张、刚才、重画…）→ 延续（refinement）。
 * 6. @ / 选中了画布上已有的图 → 延续（canvas_image：画布选中＝对成品动刀）。
 * 7. 一句新的出图 / 设计请求（做一张、画个、设计一套、我想要、帮我做…）→ 新任务（new_request）。
 * 8. 普通修改动词（改、换、去掉、不要…）→ 延续（refinement）。
 * 9. 其余（提问、闲聊、确认）→ 延续（follow_up）。
 *
 * 纯函数：不读时间、不生成随机数；时间与新 id 由调用方注入。
 */

export interface AgentTaskRef {
  id: string
  /** 开启这个任务的那句话（截短），只用于排查与展示。 */
  brief: string
  startedAt: number
  updatedAt: number
  /** 这个任务累计的用户回合数。 */
  turns: number
  /**
   * 本任务里用户显式带过的参考卡（@ chip / 从参考栏加入）。同一任务的后续回合自动沿用，
   * 新任务从空开始：旧任务的参考只有被再次提到才会重新进入（并按新任务重新分析用法）。
   */
  referenceIds: string[]
}

export interface AgentTaskSignals {
  text: string
  internalControl?: boolean
  hasActiveTaskPlan?: boolean
  hasPendingConfirmation?: boolean
  hasActiveContinuation?: boolean
  /** 上一条助手回复是一张尚未回答的问题卡。 */
  answersQuestionCard?: boolean
  /** 本轮 @ 或选中了画布上已有的图片节点。 */
  refersToCanvasImage?: boolean
  /** 本轮消息里显式 @ 的参考卡 id（按提及顺序）。 */
  referenceIds?: readonly string[]
}

export type AgentTaskDecisionReason =
  | 'first'
  | 'explicit_new'
  | 'continuation'
  | 'series'
  | 'refinement'
  | 'canvas_image'
  | 'new_request'
  | 'follow_up'

export interface AgentTaskDecision {
  task: AgentTaskRef
  continued: boolean
  reason: AgentTaskDecisionReason
}

const BRIEF_LIMIT = 80

const EXPLICIT_NEW_PATTERN =
  /换(?:个|一个)?(?:新)?(?:需求|任务|主题|话题|项目|方向)|新(?:的)?(?:需求|任务|项目)|另(?:一|外一)?个(?:需求|任务|项目)|重新开始|从头开始|从零开始|不做(?:这个|这套|这张)了|先不(?:管|做)(?:这个|这套|这张)|另外(?:帮我|再|给我)?(?:做|画|设计|生成)/

const CONTINUATION_PATTERN =
  /^(?:请)?(?:继续|接着|下一步|直接下一步|继续任务|继续生成|把剩下的(?:做|生成)完)/

const SERIES_PATTERN =
  /同(?:一)?系列|系列(?:图|海报|物料)?的?|延展|横版|竖版|方版|长图版|其他尺寸|另一个尺寸|换个尺寸|再(?:来|出|做|生成|画)|多(?:来|出)(?:几|一)|第\s*[二三四五六七八九十\d]+\s*(?:张|版|个|款)|下一(?:张|个|版|款)|另一(?:张|版|款)|配套|同款|一套里|接着做/

/** 明确指代上文成品的修改：即使句子里有「做 / 画」也算延续。 */
const STRONG_REFINEMENT_PATTERN =
  /大一[点些]|小一[点些]|再.{0,4}[点些]|更(?:亮|暗|大|小|清|多|少|简|丰|强|弱|鲜|柔)|保持|不变|放大|缩小|这张|那张|这版|那版|这一版|上一张|上一版|刚才|刚刚|上面那|前面那|它的|重新生成|重画|重做|不满意|满意/

/** 普通修改动词：只在不像一句新的出图请求时才算延续。 */
const WEAK_REFINEMENT_PATTERN =
  /改|换|调整|调一下|去掉|删掉|加上|加个|加一|挪|不要|别/

const NEW_REQUEST_PATTERN =
  /(?:做|画|生成|设计|创作|出|来|写|拍)\s*(?:一|几|两|三|四|五|六|\d+)?\s*(?:个|张|套|组|份|幅|款|版|条|段|支|只|位|件|部|页|批|系列)|(?:做|画|设计)个|我(?:想要|想|要|需要)(?:一|做|画|设计|个|张|套)|帮我(?:做|画|设计|生成|出)/

function normalized(text: string): string {
  return text.replace(/\s+/g, '').trim()
}

function briefOf(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > BRIEF_LIMIT ? `${trimmed.slice(0, BRIEF_LIMIT)}…` : trimmed
}

/** 台账 usage 的 taskKey：按任务 id，而不是按请求模式。 */
export function referenceTaskKey(task: Pick<AgentTaskRef, 'id'>): string {
  return `task:${task.id}`
}

export function isTaskReferenceKey(taskKey: string): boolean {
  return taskKey.startsWith('task:')
}

export function classifyAgentTaskTurn(
  hasPrevious: boolean,
  signals: AgentTaskSignals,
): AgentTaskDecisionReason {
  if (!hasPrevious) return 'first'
  const text = normalized(signals.text)
  if (EXPLICIT_NEW_PATTERN.test(text)) return 'explicit_new'
  if (
    signals.internalControl === true ||
    signals.hasPendingConfirmation === true ||
    signals.hasActiveContinuation === true ||
    signals.hasActiveTaskPlan === true ||
    signals.answersQuestionCard === true ||
    CONTINUATION_PATTERN.test(text)
  ) {
    return 'continuation'
  }
  if (SERIES_PATTERN.test(text)) return 'series'
  if (STRONG_REFINEMENT_PATTERN.test(text)) return 'refinement'
  if (signals.refersToCanvasImage === true) return 'canvas_image'
  if (NEW_REQUEST_PATTERN.test(text)) return 'new_request'
  if (WEAK_REFINEMENT_PATTERN.test(text)) return 'refinement'
  return 'follow_up'
}

const NEW_TASK_REASONS: ReadonlySet<AgentTaskDecisionReason> = new Set([
  'first',
  'explicit_new',
  'new_request',
])

export function resolveAgentTask(
  previous: AgentTaskRef | undefined,
  signals: AgentTaskSignals,
  env: { now: number; newId: () => string },
): AgentTaskDecision {
  const reason = classifyAgentTaskTurn(Boolean(previous), signals)
  const mentioned = [...new Set(signals.referenceIds ?? [])]
  if (previous && !NEW_TASK_REASONS.has(reason)) {
    return {
      task: {
        ...previous,
        updatedAt: env.now,
        turns: previous.turns + (signals.internalControl === true ? 0 : 1),
        referenceIds: [...new Set([...mentioned, ...previous.referenceIds])],
      },
      continued: true,
      reason,
    }
  }
  return {
    task: {
      id: env.newId(),
      brief: briefOf(signals.text),
      startedAt: env.now,
      updatedAt: env.now,
      turns: 1,
      referenceIds: mentioned,
    },
    continued: false,
    reason,
  }
}

export function normalizeAgentTaskRef(value: unknown): AgentTaskRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id) return undefined
  const startedAt = typeof row.startedAt === 'number' ? row.startedAt : 0
  return {
    id: row.id,
    brief: typeof row.brief === 'string' ? row.brief.slice(0, BRIEF_LIMIT + 1) : '',
    startedAt,
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : startedAt,
    turns:
      typeof row.turns === 'number' && Number.isFinite(row.turns) && row.turns > 0
        ? Math.trunc(row.turns)
        : 1,
    referenceIds: Array.isArray(row.referenceIds)
      ? [...new Set(row.referenceIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        ))]
      : [],
  }
}
