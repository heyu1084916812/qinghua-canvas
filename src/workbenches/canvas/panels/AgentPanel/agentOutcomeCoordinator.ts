import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type {
  ConfirmationRequestRef,
} from '../../../../domain/agent/confirmation'
import type { AgentToolName } from '../../../../domain/agent/toolRegistry'
import type {
  AgentController,
  AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopOutcome } from '../../agent/agentLoop'
import {
  composeAgentOutcomeMessages,
  type PersistedAgentUserTurn,
} from './agentTurnPersistence'
import type { AgentPanelStatus } from './AgentActivityViews'

export interface AgentOutcomeMessageReveal {
  sessionId: string
  fullText: string
  visibleLength: number
}

export interface AgentOutcomeSessionPort {
  /** 消息与确认 / 检查点 / steer 在同一事务按 revision CAS 写入。 */
  applyOutcome: (
    sessionId: string,
    input: {
      expectedRevision?: number
      deferred?: Promise<void>
      messages: readonly ChatMessage[]
      pendingConfirmation?: AgentSession['pendingConfirmation']
      continuation?: AgentSession['continuation']
      allowedToolNames?: readonly AgentToolName[]
      removeSteerIds?: readonly string[]
    },
  ) => Promise<
    | { ok: true; session: AgentSession }
    | { ok: false; reason: 'missing' | 'conflict' }
  >
  /** 迟到确认只在存储层原子合并缺失结果，不刷新界面。 */
  settleInterruptedConfirmation: (
    sessionId: string,
    request: ConfirmationRequestRef,
  ) => Promise<unknown>
  refreshSession: () => Promise<void>
}

export interface CoordinateAgentOutcomeInput {
  session: AgentSession
  outcome: AgentLoopOutcome
  persistedTurn?: PersistedAgentUserTurn
  /** 本 outcome 创建时拿到的 controller；身份比较必须一直用它。 */
  outcomeController: AbortController | undefined
  /** 本回合创建时的 Job / turn / queue / revision 身份。 */
  turnOrigin: AgentTurnOrigin
  currentOutcomeController: () => AbortController | undefined
  currentSessionId: () => string | null
  sessions: AgentOutcomeSessionPort
  transitionSessionJob: AgentController['transition']
  clearLiveActivities: () => void
  clearLiveProcess: () => void
  clearRunTasks: () => void
  setMessageReveal: (reveal: AgentOutcomeMessageReveal | null) => void
  setMessages: (messages: ChatMessage[]) => void
  applySessionSnapshot: (session: AgentSession) => void
  setStatusFor: (sessionId: string, status: AgentPanelStatus) => void
  idleStatus: AgentPanelStatus
  deleteAbortController: (
    sessionId: string,
    controller: AbortController,
  ) => void
  turnToolNames: () => readonly AgentToolName[]
  deliveredSteerIds: () => readonly string[]
  clearDeliveredSteers: () => void
  activeQueuedTurnId: () => string | undefined
  prefersReducedMotion: () => boolean
  now?: () => number
}

export type AgentOutcomeCoordinationResult =
  | 'ignored'
  | 'stale_settled'
  | 'conflict'
  | 'applied'

/**
 * 收口一次 AgentLoop outcome。
 *
 * 控制器身份只由调用方传入的同一个 AbortController 判断。该函数不读取 React
 * state，也不创建 SessionStore / Controller；所有存储、Job 和 UI 写入都通过端口。
 */
export async function coordinateAgentOutcome(
  input: CoordinateAgentOutcomeInput,
): Promise<AgentOutcomeCoordinationResult> {
  const {
    session,
    outcome,
    persistedTurn,
    outcomeController,
  } = input
  const sameController = () =>
    outcomeController !== undefined &&
    input.currentOutcomeController() === outcomeController
  const outcomeIsCurrent = () =>
    sameController() &&
    outcomeController !== undefined &&
    !outcomeController.signal.aborted

  const full = persistedTurn
    ? composeAgentOutcomeMessages(persistedTurn, outcome.messages)
    : outcome.messages
  const settleStaleOutcome = async () => {
    if (outcome.kind === 'confirm') {
      await input.sessions
        .settleInterruptedConfirmation(
          session.id,
          outcome.request,
        )
        .catch(() => null)
      return
    }
  }

  if (!outcomeIsCurrent()) {
    if (outcome.kind !== 'confirm') return 'ignored'
    await settleStaleOutcome()
    return 'stale_settled'
  }

  const pendingConfirmation =
    outcome.kind === 'confirm'
      ? {
          callId: outcome.request.callId,
          name: outcome.request.name,
          args: outcome.request.args,
        }
      : undefined
  const now = input.now ?? Date.now
  const continuation =
    outcome.kind === 'stopped' && outcome.checkpoint
      ? {
          reason: outcome.checkpoint.kind,
          maxSteps: outcome.checkpoint.maxSteps,
          createdAt: now(),
          ...(input.activeQueuedTurnId()
            ? { queuedTurnId: input.activeQueuedTurnId() }
            : {}),
        }
      : undefined
  const persistTurnTools =
    outcome.kind === 'confirm' ||
    (outcome.kind === 'stopped' && Boolean(outcome.checkpoint))
  const deliveredSteerIds = [...input.deliveredSteerIds()]
  const applied = await input.sessions.applyOutcome(session.id, {
    expectedRevision: input.turnOrigin.messageRevision,
    messages: full,
    pendingConfirmation,
    continuation,
    allowedToolNames: persistTurnTools
      ? [...input.turnToolNames()]
      : undefined,
    ...(deliveredSteerIds.length > 0
      ? { removeSteerIds: deliveredSteerIds }
      : {}),
  })
  if (!applied.ok) {
    await settleStaleOutcome()
    return applied.reason === 'conflict' ? 'conflict' : 'ignored'
  }
  const latest = applied.session
  input.clearDeliveredSteers()

  input.clearLiveActivities()
  input.clearLiveProcess()
  input.clearRunTasks()
  if (input.currentSessionId() === session.id) {
    if (
      outcome.kind === 'message' &&
      outcome.text.trim() &&
      !input.prefersReducedMotion()
    ) {
      input.setMessageReveal({
        sessionId: session.id,
        fullText: outcome.text.trim(),
        visibleLength: 0,
      })
    } else {
      input.setMessageReveal(null)
    }
    input.setMessages(full)
  }
  await input.sessions.refreshSession()
  if (!outcomeIsCurrent()) {
    await settleStaleOutcome()
    return 'stale_settled'
  }

  if (outcome.kind === 'confirm') {
    await input.transitionSessionJob(
      session.id,
      'waiting_confirmation',
      'confirmation_requested',
      { pendingCallId: outcome.request.callId },
      { tool: outcome.request.name },
      input.turnOrigin,
    )
  } else if (outcome.kind === 'stopped' && outcome.checkpoint) {
    await input.transitionSessionJob(
      session.id,
      'paused',
      'checkpoint_saved',
      {
        checkpoint: {
          kind: outcome.checkpoint.kind,
          maxSteps: outcome.checkpoint.maxSteps,
          completedSteps: outcome.checkpoint.completedSteps,
          savedAt: now(),
        },
      },
      undefined,
      input.turnOrigin,
    )
  } else if (outcome.kind === 'error' && outcome.needsAttention) {
    await input.transitionSessionJob(
      session.id,
      'needs_attention',
      'tool_failed',
      {
        lastError: outcome.needsAttention.reason,
        ...(outcome.needsAttention.toolCallId
          ? { pendingCallId: outcome.needsAttention.toolCallId }
          : {}),
      },
      {
        phase: 'tool_effect_pending',
        reason: outcome.needsAttention.reason,
      },
      input.turnOrigin,
    )
  } else if (outcome.kind === 'message') {
    await input.transitionSessionJob(
      session.id,
      'completed',
      'completed',
      undefined,
      undefined,
      input.turnOrigin,
    )
  } else {
    const reason =
      outcome.kind === 'error' ? outcome.message : outcome.reason
    await input.transitionSessionJob(
      session.id,
      'failed',
      'failed',
      { lastError: reason },
      { reason },
      input.turnOrigin,
    )
  }
  if (!outcomeIsCurrent()) {
    await settleStaleOutcome()
    return 'stale_settled'
  }

  if (
    outcome.kind === 'message' ||
    outcome.kind === 'error' ||
    (outcome.kind === 'stopped' && !outcome.checkpoint)
  ) {
    if (outcomeController) {
      input.deleteAbortController(session.id, outcomeController)
    }
  }
  input.applySessionSnapshot(latest)

  if (outcome.kind === 'message') {
    input.setStatusFor(session.id, input.idleStatus)
  } else if (outcome.kind === 'confirm') {
    input.setStatusFor(session.id, {
      kind: 'awaitingConfirm',
      request: outcome.request,
    })
  } else if (outcome.kind === 'stopped' && outcome.checkpoint) {
    input.setStatusFor(session.id, {
      kind: 'paused',
      message: `已完成 ${outcome.checkpoint.maxSteps} 步，可继续`,
    })
  } else if (outcome.kind === 'stopped') {
    input.setStatusFor(session.id, {
      kind: 'error',
      message: outcome.reason,
    })
  } else {
    input.setStatusFor(session.id, {
      kind: 'error',
      message: outcome.message,
    })
  }
  return 'applied'
}
