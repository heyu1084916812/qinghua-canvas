import type {
  AgentController,
  AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'

export interface AgentInterruptSettlementInput {
  session: AgentSession
  request: AgentToolRequest | undefined
  result: 'canceled' | 'interrupted'
  turnOrigin: AgentTurnOrigin
  abortController: AbortController | undefined
  isActivityActive: () => boolean
  turnMatchesActivity: (
    queueTurnId: string | undefined,
    turnId: string | undefined,
  ) => boolean
  queueTurnMatchesActivity: (
    queueTurnId: string,
  ) => boolean
  clearQueueDrain: () => void
  settleSession: (
    sessionId: string,
    request: AgentToolRequest | undefined,
    result: 'canceled' | 'interrupted',
    expectedRevision?: number,
  ) => Promise<AgentSession | null>
  transitionSessionJob: AgentController['transition']
  removeSteers: (
    sessionId: string,
    steerIds: readonly string[],
  ) => Promise<AgentSession | null>
  finishQueuedTurn: (
    sessionId: string,
    turnId: string,
    completed: boolean,
  ) => Promise<AgentSession | null>
  releaseActivity: (
    queueTurnId: string | undefined,
    turnId: string | undefined,
  ) => void
  isCurrentSession: () => boolean
  notify: (message: string, tone: 'error') => void
  deletePerSessionRefs: (sessionId: string) => void
  applySessionSnapshot: (session: AgentSession) => void
  setMessages: (messages: AgentSession['messages']) => void
  clearLiveActivities: () => void
  clearLiveProcess: () => void
  clearRunTasks: () => void
  setStatus: (
    sessionId: string,
    status: { kind: 'idle' },
  ) => void
  errorText: (error: unknown) => string
}

/**
 * stop / cancel 的共享收口。
 *
 * 每一步 cleanup 独立尝试并汇总首个错误；只有仍拥有本回合活动锁时才 abort /
 * clear drain。存储层用 revision 作为停止屏障，Job 与 queue 都绑定本回合 origin。
 * UI / per-session refs 只在最终仍拥有活动锁时更新，迟到旧结算不能覆盖新回合。
 */
export async function settleAgentInterruption(
  input: AgentInterruptSettlementInput,
): Promise<AgentSession | null> {
  const { session, request, result, turnOrigin } = input
  const queueTurnId = turnOrigin.queueTurnId
  const ownsActivity = () =>
    !input.isActivityActive() ||
    input.turnMatchesActivity(queueTurnId, turnOrigin.turnId)
  let latest: AgentSession | null = null
  let cleanupError: unknown

  if (ownsActivity()) {
    input.abortController?.abort()
    input.clearQueueDrain()
  }

  const attempt = async (work: () => Promise<void>) => {
    try {
      await work()
    } catch (error) {
      cleanupError ??= error
    }
  }

  await attempt(async () => {
    latest = await input.settleSession(
      session.id,
      request,
      result,
      turnOrigin.messageRevision,
    )
  })
  await attempt(async () => {
    await input.transitionSessionJob(
      session.id,
      'canceled',
      'interrupted',
      { pendingCallId: undefined },
      {
        reason:
          result === 'canceled'
            ? 'user_canceled_confirmation'
            : 'user_stopped',
      },
      turnOrigin,
    )
  })
  await attempt(async () => {
    if (session.pendingSteers.length > 0) {
      latest =
        (await input.removeSteers(
          session.id,
          session.pendingSteers.map((steer) => steer.id),
        )) ?? latest
    }
  })
  await attempt(async () => {
    if (
      queueTurnId &&
      input.queueTurnMatchesActivity(queueTurnId)
    ) {
      latest =
        (await input.finishQueuedTurn(
          session.id,
          queueTurnId,
          false,
        )) ?? latest
    }
  })

  if (cleanupError) {
    input.notify(
      `停止任务时清理状态失败：${input.errorText(cleanupError)}`,
      'error',
    )
  }
  const ownsUiState = ownsActivity()
  input.releaseActivity(queueTurnId, turnOrigin.turnId)
  if (ownsUiState) {
    input.deletePerSessionRefs(session.id)
  }
  const settledSession = latest as AgentSession | null
  if (ownsUiState && settledSession !== null) {
    input.applySessionSnapshot(settledSession)
    if (input.isCurrentSession()) {
      input.setMessages(settledSession.messages)
    }
  }
  if (ownsUiState) {
    input.clearLiveActivities()
    input.clearLiveProcess()
    input.clearRunTasks()
    input.setStatus(session.id, { kind: 'idle' })
  }
  return settledSession
}
