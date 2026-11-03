import type { ChatMessage, ToolDeclaration } from '../../../../domain/shared/execution/types'
import type {
  AgentController,
  AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
import type { QueuedAgentTurn } from '../../../../domain/agent/queuedTurn'
import { createId } from '../../../../shared/id'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChatRoutePreparation } from './agentChatRoute'
import {
  errText,
  type AgentLoopDeps,
  type AgentLoopOutcome,
} from '../../agent/agentLoop'
import type {
  AgentOutcomeCoordinationResult,
} from './agentOutcomeCoordinator'

type AgentContinuationStatus =
  | { kind: 'thinking' }
  | { kind: 'error'; message: string }

export interface AgentContinuationLoopDepsInput {
  session: AgentSession
  operationId: string
  toolMode: 'native' | 'json'
  visualNodeIds: readonly string[]
  turnTools: readonly ToolDeclaration[]
  turnController: AbortController
}

export interface AgentContinuationRunInput {
  session: AgentSession
  messages: readonly ChatMessage[]
  activeQueueTurnId: () => string | undefined
  currentTurnId: () => string | undefined
  turnOrigin: (
    turnId: string,
    queueTurnId: string | undefined,
  ) => AgentTurnOrigin
  isActivityActive: () => boolean
  claimNextQueuedTurn: (
    sessionId: string,
  ) => Promise<{
    session: AgentSession
    turn: QueuedAgentTurn
  } | null>
  claimActivity: (
    sessionId: string,
    queueTurnId: string | undefined,
    turnId: string,
  ) => boolean
  applySessionSnapshot: (session: AgentSession) => void
  ensureRoute: (session: AgentSession) => Promise<ChatRoutePreparation>
  createLoopDeps: (
    input: AgentContinuationLoopDepsInput,
  ) => AgentLoopDeps
  toolMode: () => 'native' | 'json'
  turnTools: () => readonly ToolDeclaration[]
  transitionSessionJob: AgentController['transition']
  setAbortController: (controller: AbortController) => void
  setStatus: (status: AgentContinuationStatus) => void
  runAgentTurn: (
    history: readonly ChatMessage[],
    deps: AgentLoopDeps,
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
  isCurrentSession: () => boolean
  setMessages: (messages: ChatMessage[]) => void
  createTurnId?: () => string
  createAbortController?: () => AbortController
}

export type AgentContinuationRunResult =
  | AgentOutcomeCoordinationResult
  | 'busy'
  | 'aborted'
  | 'failed'

function latestUserImageNodeIds(
  messages: readonly ChatMessage[],
): string[] {
  return [
    ...new Set(
      [...messages]
        .reverse()
        .find((message) => message.role === 'user')
        ?.imageNodeIds ?? [],
    ),
  ]
}

/**
 * 从持久检查点继续一个 Agent 回合。
 *
 * 队列领取、活动锁、Job 迁移、模型循环和结果收口都绑定本函数创建的 turn origin。
 * React 宿主只提供 refs / store / UI 端口。
 */
export async function runAgentContinuation(
  input: AgentContinuationRunInput,
): Promise<AgentContinuationRunResult> {
  let queueTurnId =
    input.activeQueueTurnId() ??
    input.session.continuation?.queuedTurnId
  const continuationTurnId =
    queueTurnId ??
    input.currentTurnId() ??
    (input.createTurnId?.() ?? createId('turnmsg'))

  if (!input.isActivityActive()) {
    if (
      queueTurnId &&
      input.session.queuedTurns[0]?.id === queueTurnId
    ) {
      const claimed = await input.claimNextQueuedTurn(input.session.id)
      if (claimed?.session) input.applySessionSnapshot(claimed.session)
      queueTurnId = claimed?.turn.id
    } else {
      queueTurnId = undefined
    }
    if (
      !input.claimActivity(
        input.session.id,
        queueTurnId,
        continuationTurnId,
      )
    ) {
      return 'busy'
    }
  }

  const continuationOrigin = input.turnOrigin(
    continuationTurnId,
    queueTurnId,
  )
  const continuationAbort =
    input.createAbortController?.() ?? new AbortController()
  input.setAbortController(continuationAbort)
  const failRoute = async (message: string) => {
    const outcome: AgentLoopOutcome = {
      kind: 'error',
      message,
      messages: [...input.messages],
      phase: 'continuation_route',
    }
    let applied: AgentOutcomeCoordinationResult = 'ignored'
    let cleanupError: string | undefined
    try {
      applied = await input.handleOutcome(
        input.session,
        outcome,
        undefined,
        continuationAbort,
      )
    } catch (error) {
      cleanupError = errText(error)
    }
    if (cleanupError) {
      try {
        const transitioned = await input.transitionSessionJob(
          input.session.id,
          'failed',
          'failed',
          { lastError: message },
          { phase: 'continuation_route' },
          continuationOrigin,
        )
        if (!transitioned) {
          cleanupError = `${cleanupError}；Job 转态未命中`
        }
      } catch (error) {
        cleanupError = `${cleanupError}；Job 失败收口：${errText(error)}`
      }
      input.setStatus({
        kind: 'error',
        message: `${message}；检查点收口失败：${cleanupError}`,
      })
    }
    try {
      await input.settleSessionOutcome(
        input.session.id,
        outcome,
        continuationOrigin,
      )
    } catch (error) {
      input.setStatus({
        kind: 'error',
        message: `${message}；活动锁收口失败：${errText(error)}`,
      })
      return 'failed'
    }
    if (cleanupError) return 'failed'
    return applied === 'applied' ? 'failed' : applied
  }
  let route: Awaited<ReturnType<AgentContinuationRunInput['ensureRoute']>>
  try {
    route = await input.ensureRoute(input.session)
  } catch (error) {
    return failRoute(errText(error))
  }
  if (!route.ok) return failRoute(route.message)
  const currentLoopDeps = input.createLoopDeps({
    session: input.session,
    operationId: createId('op'),
    toolMode: input.toolMode(),
    visualNodeIds: latestUserImageNodeIds(input.messages),
    turnTools: input.turnTools(),
    turnController: continuationAbort,
  })
  await input.transitionSessionJob(
    input.session.id,
    'planning',
    'status_changed',
    { pendingCallId: undefined },
    { resumedFromCheckpoint: true },
    continuationOrigin,
  )
  input.setStatus({ kind: 'thinking' })
  try {
    const initial = await input.runAgentTurn(
      input.messages,
      currentLoopDeps,
    )
    const outcome = await input.continueAutoConfirmations(
      input.session,
      initial,
      currentLoopDeps,
      (next) => {
        if (input.isCurrentSession()) input.setMessages(next)
      },
    )
    const applied = await input.handleOutcome(
      input.session,
      outcome,
      undefined,
      continuationAbort,
    )
    await input.settleSessionOutcome(
      input.session.id,
      outcome,
      continuationOrigin,
    )
    return applied
  } catch (error) {
    if (continuationAbort.signal.aborted) return 'aborted'
    input.setStatus({ kind: 'error', message: errText(error) })
    await input.settleSessionOutcome(
      input.session.id,
      { kind: 'error' },
      continuationOrigin,
    )
    return 'failed'
  }
}
