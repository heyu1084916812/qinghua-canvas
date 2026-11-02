import type {
  MutableRefObject,
} from 'react'
import type { AgentLoopOutcome } from '../../agent/agentLoop'
import { errText } from '../../agent/agentLoop'
import {
  claimSessionActivity,
  releaseSessionActivity,
  shouldDrainQueue,
} from '../../../../features/canvas/agent/sessionActivity'
import { AgentToolEffectBlockedError } from '../../../../features/shared/agent/AgentToolEffectLedger'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { IDLE_STATUS, type AgentPanelStatus } from './AgentActivityViews'

export interface AgentSendFlowInput {
  session: AgentSession
  text: string
  controller: AgentController
  abortRefs: MutableRefObject<Map<string, AbortController>>
  deliveredSteersRef: MutableRefObject<Map<string, Set<string>>>
  preclaimed?: boolean
  queueTurnId?: string
  internalControl?: boolean
  runTurn: (
    text: string,
    session: AgentSession,
    turnId?: string,
    internalControl?: boolean,
  ) => Promise<AgentLoopOutcome | undefined>
  applySessionSnapshot: (session: AgentSession) => void
  clearLiveActivitiesFor: (sessionId: string) => void
  clearLiveProcessFor: (sessionId: string) => void
  clearRunTasksFor: (sessionId: string) => void
  setStatusFor: (sessionId: string, status: AgentPanelStatus) => void
  transitionSessionJob: AgentController['transition']
  queuePump: (sessionId: string) => void
}

/** 发送前的滚动表现仍留在视图宿主，业务函数不接触 React DOM。 */
export function beforeAgentSendFlow(
  sessionId: string,
  currentSessionId: string | null,
  followLatest: () => void,
): void {
  if (currentSessionId === sessionId) followLatest()
}

/**
 * 只协调“已选会话的一次发送”。历史读取、路由、探测和循环注入 runTurn；
 * 这里不拥有队列或消息真相，避免与 Session / Controller 产生第二份状态。
 */
export async function runAgentSendFlow({
  session,
  text,
  controller,
  abortRefs,
  deliveredSteersRef,
  preclaimed = false,
  queueTurnId,
  internalControl = false,
  runTurn,
  applySessionSnapshot,
  clearLiveActivitiesFor,
  clearLiveProcessFor,
  clearRunTasksFor,
  setStatusFor,
  transitionSessionJob,
  queuePump,
}: AgentSendFlowInput): Promise<AgentLoopOutcome | undefined> {
  if (!preclaimed && !claimSessionActivity(session.id, queueTurnId)) {
    return undefined
  }
  /**
   * 已经领取了活动锁：除 confirm / checkpoint 这两种等待后续动作的状态外，
   * 任何成功或失败出口都必须从 finally 释放。
   */
  let finishQueueAttempted = false
  let finishQueueError: unknown
  let retainActivity = false
  let outcome: AgentLoopOutcome | undefined
  const finishQueue = async (completed: boolean) => {
    if (!queueTurnId || finishQueueAttempted) return
    finishQueueAttempted = true
    try {
      const next = await controller.finishQueuedTurn(
        session.id,
        queueTurnId,
        completed,
      )
      if (next) applySessionSnapshot(next)
    } catch (error) {
      finishQueueError = error
    }
  }

  try {
    outcome = await runTurn(
      text,
      session,
      queueTurnId,
      internalControl,
    )
    if (!outcome) {
      await finishQueue(false)
      abortRefs.current.delete(session.id)
      if (finishQueueError) {
        setStatusFor(session.id, {
          kind: 'error',
          message: errText(finishQueueError),
        })
      }
      return undefined
    }
    const paused =
      outcome.kind === 'stopped' && outcome.checkpoint !== undefined
    if (outcome.kind === 'confirm' || paused) {
      retainActivity = true
      return outcome
    }
    await finishQueue(outcome.kind === 'message')
    if (finishQueueError) {
      setStatusFor(session.id, {
        kind: 'error',
        message: errText(finishQueueError),
      })
      return outcome
    }
    if (outcome.kind === 'message' && shouldDrainQueue(session.id)) {
      queueMicrotask(() => queuePump(session.id))
    }
  } catch (error) {
    const aborted = abortRefs.current.get(session.id)?.signal.aborted === true
    const blocked =
      error instanceof AgentToolEffectBlockedError ? error : null
    deliveredSteersRef.current.delete(session.id)
    clearLiveActivitiesFor(session.id)
    clearLiveProcessFor(session.id)
    clearRunTasksFor(session.id)
    let transitionError: unknown
    try {
      await transitionSessionJob(
        session.id,
        aborted ? 'canceled' : blocked?.status ?? 'failed',
        aborted ? 'interrupted' : blocked ? 'tool_failed' : 'failed',
        aborted
          ? {}
          : {
              lastError: errText(error),
              ...(blocked?.status === 'needs_attention'
                ? { pendingCallId: blocked.outcome.effect.toolCallId }
                : {}),
            },
        { phase: 'run_send_text' },
      )
    } catch (error) {
      transitionError = error
    }
    await finishQueue(false)
    const cleanupError = transitionError ?? finishQueueError
    setStatusFor(
      session.id,
      cleanupError
        ? { kind: 'error', message: errText(cleanupError) }
        : aborted
          ? IDLE_STATUS
          : { kind: 'error', message: errText(error) },
    )
    return undefined
  } finally {
    if (!retainActivity) releaseSessionActivity(session.id, queueTurnId)
  }
  return outcome
}
