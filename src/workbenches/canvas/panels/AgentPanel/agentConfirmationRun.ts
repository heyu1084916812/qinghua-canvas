import type { ChatMessage, ToolDeclaration } from '../../../../domain/shared/execution/types'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import type {
  AgentController,
  AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
import {
  AgentToolEffectBlockedError,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import { createId } from '../../../../shared/id'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  confirmationRunsGeneration,
} from '../../../../domain/agent/confirmation'
import {
  errText,
  type AgentLoopDeps,
  type AgentLoopOutcome,
} from '../../agent/agentLoop'
import type {
  AgentOutcomeCoordinationResult,
} from './agentOutcomeCoordinator'
import type {
  AgentChatRoute,
  ChatRoutePreparation,
} from './agentChatRoute'

type AgentConfirmationStatus =
  | { kind: 'thinking' }
  | { kind: 'executing'; tool?: string }
  | { kind: 'error'; message: string }

export interface AgentConfirmationLoopDepsInput {
  session: AgentSession
  operationId: string
  route: AgentChatRoute
  toolMode: 'native' | 'json'
  visualNodeIds: readonly string[]
  turnTools: readonly ToolDeclaration[]
  turnController: AbortController
}

export interface AgentConfirmationRunInput {
  session: AgentSession
  request: AgentToolRequest
  messages: readonly ChatMessage[]
  /** 本回合创建时的 Job / queue / turn / revision 身份。 */
  turnOrigin: () => AgentTurnOrigin
  beginConfirmation: AgentController['beginConfirmation']
  finishConfirmedTool: AgentController['finishConfirmedTool']
  executeConfirmedTool: (
    session: AgentSession,
    request: AgentToolRequest,
  ) => Promise<unknown>
  loadLatestRevision: (sessionId: string) => Promise<number | undefined>
  /**
   * 工具执行期间渠道表、模型选择或面板宿主都可能变化，发送开始时的路由缓存
   * 不能假设一定还在。续跑前必须重新确保对话路由，不能拿空 channelId 请求模型。
   */
  ensureRoute: (session: AgentSession) => Promise<ChatRoutePreparation>
  createLoopDeps: (
    input: AgentConfirmationLoopDepsInput,
  ) => AgentLoopDeps
  toolMode: () => 'native' | 'json'
  turnTools: () => readonly ToolDeclaration[]
  resumeAgentTurn: (
    history: readonly ChatMessage[],
    callId: string,
    payload: unknown,
    deps: AgentLoopDeps,
    toolName?: string,
  ) => Promise<AgentLoopOutcome>
  continueAutoConfirmations: (
    session: AgentSession,
    initial: AgentLoopOutcome,
    loopDeps: AgentLoopDeps,
    onMessages: (messages: ChatMessage[]) => void,
  ) => Promise<AgentLoopOutcome>
  handleOutcome: (
    session: AgentSession,
    outcome: AgentLoopOutcome,
    persistedTurn: undefined,
    outcomeController: AbortController,
    origin?: AgentTurnOrigin,
  ) => Promise<AgentOutcomeCoordinationResult>
  settleSessionOutcome: (
    sessionId: string,
    outcome: AgentLoopOutcome | { kind: 'error' },
    origin?: AgentTurnOrigin,
  ) => Promise<void>
  transitionSessionJob: AgentController['transition']
  setAbortController: (controller: AbortController) => void
  setStatus: (status: AgentConfirmationStatus) => void
  isCurrentSession: () => boolean
  setMessages: (messages: ChatMessage[]) => void
  createAbortController?: () => AbortController
  /** 测试可缩短；产品默认覆盖对话适配器 60s 超时。 */
  routeTimeoutMs?: number
  summaryTimeoutMs?: number
  /** 无任务计划的单节点生成成功后，直接本地给出简洁完成语。 */
  localGenerationSummary?: boolean
}

export type AgentConfirmationRunResult =
  | AgentOutcomeCoordinationResult
  | 'aborted'
  | 'needs_attention'
  | 'failed'

const DEFAULT_ROUTE_TIMEOUT_MS = 30_000
const DEFAULT_SUMMARY_TIMEOUT_MS = 90_000

class AgentSummaryTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label}超过 ${Math.round(timeoutMs / 1000)} 秒仍未返回`)
    this.name = 'AgentSummaryTimeoutError'
  }
}

async function withSummaryTimeout<T>(
  promise: Promise<T>,
  controller: AbortController,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(new AgentSummaryTimeoutError(label, timeoutMs))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function latestUserImageNodeIds(
  messages: readonly ChatMessage[],
): string[] {
  const ids =
    [...messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.imageNodeIds ?? []
  return [...new Set(ids)]
}

function confirmedGenerationSucceeded(result: unknown): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return false
  }
  const outcomes = (result as { outcomes?: unknown }).outcomes
  return (
    Array.isArray(outcomes) &&
    outcomes.length > 0 &&
    outcomes.every(
      (item) =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        (item as { ok?: unknown }).ok !== false,
    )
  )
}

/**
 * 执行一张人工确认卡，并把工具结果续跑回模型。
 *
 * 本函数只接收端口，不读取 React refs/state；确认卡仍是 Controller / SessionStore
 * 的真相，工具副作用仍经过持久账本。
 */
export async function runAgentConfirmation(
  input: AgentConfirmationRunInput,
): Promise<AgentConfirmationRunResult> {
  let confirmationAbort =
    input.createAbortController?.() ?? new AbortController()
  let confirmationOrigin: AgentTurnOrigin = {}
  let confirmedResult: unknown
  input.setAbortController(confirmationAbort)
  const messageOutcomeOf = (
    messages: readonly ChatMessage[],
    text: string,
  ): AgentLoopOutcome => {
    const hasToolResult = messages.some(
      (message) =>
        message.role === 'tool' &&
        message.toolCallId === input.request.callId,
    )
    return {
      kind: 'message',
      text,
      messages: [
        ...messages,
        ...(!hasToolResult
          ? [
              {
                role: 'tool' as const,
                toolCallId: input.request.callId,
                toolName: input.request.name,
                content: JSON.stringify(confirmedResult ?? {}),
                createdAt: Date.now(),
              },
            ]
          : []),
        {
          role: 'assistant',
          content: text,
          createdAt: Date.now(),
        },
      ],
    }
  }
  const settleMessage = async (
    messages: readonly ChatMessage[],
    text: string,
  ): Promise<AgentOutcomeCoordinationResult> => {
    const outcome = messageOutcomeOf(messages, text)
    if (confirmationAbort.signal.aborted) {
      confirmationAbort =
        input.createAbortController?.() ?? new AbortController()
      input.setAbortController(confirmationAbort)
    }
    const applied = await input.handleOutcome(
      input.session,
      outcome,
      undefined,
      confirmationAbort,
      confirmationOrigin,
    )
    await input.settleSessionOutcome(
      input.session.id,
      outcome,
      confirmationOrigin,
    )
    return applied
  }
  const settlePartial = (
    messages: readonly ChatMessage[],
    reason: string,
  ): Promise<AgentOutcomeCoordinationResult> => {
    const label = confirmationRunsGeneration(input.request.name)
      ? '生成'
      : '操作'
    return settleMessage(
      messages,
      `${label}已完成，但后续总结对话模型暂时不可用：${reason}。` +
        '结果和运行记录已保留，本次不会重复执行。',
    )
  }
  try {
    confirmationOrigin = input.turnOrigin()
    await input.beginConfirmation(
      input.session.id,
      input.request,
      confirmationOrigin,
    )
    const latestRevision = await input.loadLatestRevision(input.session.id)
    if (latestRevision !== undefined) {
      confirmationOrigin = {
        ...confirmationOrigin,
        messageRevision: latestRevision,
      }
    }
    input.setStatus({
      kind: 'executing',
      tool: input.request.name,
    })
    confirmedResult = await input.executeConfirmedTool(
      input.session,
      input.request,
    )
    if (confirmationRunsGeneration(input.request.name)) {
      await input.finishConfirmedTool(
        input.session.id,
        input.request,
        confirmationOrigin,
      )
    }
    if (
      (input.request.name === 'runNode' ||
        input.request.name === 'runFrom') &&
      input.localGenerationSummary === true &&
      confirmedGenerationSucceeded(confirmedResult)
    ) {
      return settleMessage(
        input.messages,
        '生成已完成，新图和运行记录已经保留；本次没有重复执行。',
      )
    }
    let route: ChatRoutePreparation
    try {
      route = await withSummaryTimeout(
        input.ensureRoute(input.session),
        confirmationAbort,
        input.routeTimeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS,
        '对话路由',
      )
    } catch (error) {
      if (
        confirmationAbort.signal.aborted &&
        !(error instanceof AgentSummaryTimeoutError)
      ) {
        return 'aborted'
      }
      return settlePartial(input.messages, errText(error))
    }
    if (!route.ok) {
      return settlePartial(input.messages, route.message)
    }
    const currentLoopDeps = input.createLoopDeps({
      session: input.session,
      operationId: createId('op'),
      route: route.route,
      toolMode: input.toolMode(),
      visualNodeIds: latestUserImageNodeIds(input.messages),
      turnTools: input.turnTools(),
      turnController: confirmationAbort,
    })
    input.setStatus({ kind: 'thinking' })
    let resumed: AgentLoopOutcome
    try {
      resumed = await withSummaryTimeout(
        input.resumeAgentTurn(
          input.messages,
          input.request.callId,
          confirmedResult,
          currentLoopDeps,
          input.request.name,
        ),
        confirmationAbort,
        input.summaryTimeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS,
        '总结对话',
      )
    } catch (error) {
      if (
        confirmationAbort.signal.aborted &&
        !(error instanceof AgentSummaryTimeoutError)
      ) {
        return 'aborted'
      }
      return settlePartial(input.messages, errText(error))
    }
    if (resumed.kind === 'error') {
      return settlePartial(resumed.messages, resumed.message)
    }
    let latestMessages = resumed.messages
    let outcome: AgentLoopOutcome
    try {
      outcome = await withSummaryTimeout(
        input.continueAutoConfirmations(
          input.session,
          resumed,
          currentLoopDeps,
          (next) => {
            latestMessages = next
            if (input.isCurrentSession()) input.setMessages(next)
          },
        ),
        confirmationAbort,
        input.summaryTimeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS,
        '自动续跑',
      )
    } catch (error) {
      if (
        confirmationAbort.signal.aborted &&
        !(error instanceof AgentSummaryTimeoutError)
      ) {
        return 'aborted'
      }
      return settlePartial(latestMessages, errText(error))
    }
    if (outcome.kind === 'error') {
      return settlePartial(outcome.messages, outcome.message)
    }
    const applied = await input.handleOutcome(
      input.session,
      outcome,
      undefined,
      confirmationAbort,
      confirmationOrigin,
    )
    await input.settleSessionOutcome(
      input.session.id,
      outcome,
      confirmationOrigin,
    )
    return applied
  } catch (error) {
    if (confirmationAbort.signal.aborted) return 'aborted'
    const blocked =
      error instanceof AgentToolEffectBlockedError ? error : null
    input.setStatus({ kind: 'error', message: errText(error) })
    /**
     * 失败收口的三步顺序（与 `agentContinuationRun` 的 `failRoute` 对齐，#916）：
     * 1) 先把可见错误摆出来（上面那行）；
     * 2) Job 转态**单独兜住** —— 它会抛（store 写失败 / 生命周期已关闭）。
     *    以前这里没有 try/catch：一旦抛错，下面那行 settle 根本执行不到；
     * 3) `settleSessionOutcome` 必须**无条件**执行 —— 释放内存活动锁的正是它
     *    （`releaseSessionActivity`）。跳过它，`claimSessionActivity` 就恒为 false，
     *    之后发消息 / 排队 / 续跑全判 busy；而 error 态下停止按钮不渲染，
     *    面板内没有手动恢复入口。
     */
    try {
      await input.transitionSessionJob(
        input.session.id,
        blocked?.status ?? 'failed',
        blocked ? 'tool_failed' : 'failed',
        {
          lastError: errText(error),
          ...(blocked?.status === 'needs_attention'
            ? { pendingCallId: blocked.outcome.effect.toolCallId }
            : {}),
        },
        { phase: 'confirmed_tool' },
        confirmationOrigin,
      )
    } catch (transitionError) {
      // 不许静默吞：并进状态文案，用户看得到、日志里也有
      input.setStatus({
        kind: 'error',
        message: `${errText(error)}；Job 转态失败：${errText(transitionError)}`,
      })
    }
    try {
      await input.settleSessionOutcome(
        input.session.id,
        { kind: 'error' },
        confirmationOrigin,
      )
    } catch (settleError) {
      input.setStatus({
        kind: 'error',
        message: `${errText(error)}；活动锁收口失败：${errText(settleError)}`,
      })
      return 'failed'
    }
    return blocked?.status ?? 'failed'
  }
}
