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
}

export type AgentConfirmationRunResult =
  | AgentOutcomeCoordinationResult
  | 'aborted'
  | 'needs_attention'
  | 'failed'

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

/**
 * 执行一张人工确认卡，并把工具结果续跑回模型。
 *
 * 本函数只接收端口，不读取 React refs/state；确认卡仍是 Controller / SessionStore
 * 的真相，工具副作用仍经过持久账本。
 */
export async function runAgentConfirmation(
  input: AgentConfirmationRunInput,
): Promise<AgentConfirmationRunResult> {
  const confirmationAbort =
    input.createAbortController?.() ?? new AbortController()
  let confirmationOrigin: AgentTurnOrigin = {}
  input.setAbortController(confirmationAbort)
  try {
    confirmationOrigin = input.turnOrigin()
    await input.beginConfirmation(
      input.session.id,
      input.request,
      confirmationOrigin,
    )
    input.setStatus({
      kind: 'executing',
      tool: input.request.name,
    })
    const result = await input.executeConfirmedTool(
      input.session,
      input.request,
    )
    const route = await input.ensureRoute(input.session)
    if (!route.ok) throw new Error(route.message)
    const currentLoopDeps = input.createLoopDeps({
      session: input.session,
      operationId: createId('op'),
      route: route.route,
      toolMode: input.toolMode(),
      visualNodeIds: latestUserImageNodeIds(input.messages),
      turnTools: input.turnTools(),
      turnController: confirmationAbort,
    })
    if (confirmationRunsGeneration(input.request.name)) {
      await input.finishConfirmedTool(
        input.session.id,
        input.request,
        confirmationOrigin,
      )
    }
    input.setStatus({ kind: 'thinking' })
    const resumed = await input.resumeAgentTurn(
      input.messages,
      input.request.callId,
      result,
      currentLoopDeps,
      input.request.name,
    )
    const outcome = await input.continueAutoConfirmations(
      input.session,
      resumed,
      currentLoopDeps,
      (next) => {
        if (input.isCurrentSession()) input.setMessages(next)
      },
    )
    const applied = await input.handleOutcome(
      input.session,
      outcome,
      undefined,
      confirmationAbort,
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
