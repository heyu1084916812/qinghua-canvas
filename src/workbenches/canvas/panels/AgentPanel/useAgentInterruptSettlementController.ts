import { useCallback, type MutableRefObject } from 'react'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { errText, type AgentToolRequest } from '../../agent/agentLoop'
import type { AgentPanelStatus } from './AgentActivityViews'
import {
  clearTurnRefs,
  interruptOriginFor,
  type AgentTurnOriginLookup,
  type AgentTurnRefMaps,
} from './agentInterruptOrigin'
import {
  settleAgentInterruption,
  type AgentInterruptionSettlementResult,
} from './agentInterruptSettlement'

export interface AgentInterruptSettlementControllerInput {
  controller: AgentTurnOriginLookup &
    Pick<AgentController, 'finishQueuedTurn'>
  activeQueueTurnOf: (sessionId: string) => string | undefined
  currentIdRef: MutableRefObject<string | null>
  /** 六张 per-session 表：origin 读其中三张，收口时六张一起清。 */
  refs: AgentTurnRefMaps
  isActivityActive: (sessionId: string) => boolean
  turnMatchesActivity: (
    sessionId: string,
    queueTurnId: string | undefined,
    turnId: string | undefined,
  ) => boolean
  queueTurnMatchesActivity: (
    sessionId: string,
    queueTurnId: string | undefined,
  ) => boolean
  clearQueueDrain: (sessionId: string) => void
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
  releaseActivity: (
    sessionId: string,
    queueTurnId: string | undefined,
    turnId: string | undefined,
  ) => void
  applySessionSnapshot: (session: AgentSession) => void
  setMessages: (messages: AgentSession['messages']) => void
  clearLiveActivities: (sessionId: string) => void
  clearLiveProcess: (sessionId: string) => void
  clearRunTasks: (sessionId: string) => void
  setStatus: (sessionId: string, status: AgentPanelStatus) => void
  notify: (message: string, tone?: 'info' | 'error') => void
}

export type AgentInterruptSettlement = (
  session: AgentSession,
  request: AgentToolRequest | undefined,
  result: 'canceled' | 'interrupted',
) => Promise<AgentInterruptionSettlementResult>

/**
 * stop / cancel 的 React 装配层。
 *
 * 顺序、所有权判定、revision 屏障与六张表的清理都在两个纯模块里
 * （`agentInterruptOrigin.ts` / `agentInterruptSettlement.ts`）；这里只把
 * per-session refs 与 UI 回调接成端口，并按原样把 `cleanupError` 提示一次。
 *
 * 端口都收 sessionId 而不是预先绑定的会话：这样返回的回调在渲染之间保持
 * 同一身份，不会因为内联箭头每帧重建而连带重建下游控制器。
 */
export function useAgentInterruptSettlementController(
  input: AgentInterruptSettlementControllerInput,
): AgentInterruptSettlement {
  const settleInterruptedSession = useCallback<AgentInterruptSettlement>(
    async (session, request, result) => {
      const turnOrigin = interruptOriginFor({
        session,
        refs: input.refs,
        controller: input.controller,
        activeQueueTurnOf: input.activeQueueTurnOf,
      })
      const settlement = await settleAgentInterruption({
        session,
        request,
        result,
        turnOrigin,
        abortController: input.refs.abort.current.get(session.id),
        isActivityActive: () => input.isActivityActive(session.id),
        turnMatchesActivity: (queueTurnId, turnId) =>
          input.turnMatchesActivity(
            session.id,
            queueTurnId,
            turnId,
          ),
        queueTurnMatchesActivity: (queueTurnId) =>
          input.queueTurnMatchesActivity(session.id, queueTurnId),
        clearQueueDrain: () => input.clearQueueDrain(session.id),
        settleSession: input.settleSession,
        transitionSessionJob: input.transitionSessionJob,
        removeSteers: input.removeSteers,
        finishQueuedTurn: input.controller.finishQueuedTurn,
        releaseActivity: (queueTurnId, turnId) =>
          input.releaseActivity(session.id, queueTurnId, turnId),
        isCurrentSession: () =>
          input.currentIdRef.current === session.id,
        deletePerSessionRefs: (sessionId) =>
          clearTurnRefs(input.refs, sessionId),
        applySessionSnapshot: input.applySessionSnapshot,
        setMessages: input.setMessages,
        clearLiveActivities: () =>
          input.clearLiveActivities(session.id),
        clearLiveProcess: () => input.clearLiveProcess(session.id),
        clearRunTasks: () => input.clearRunTasks(session.id),
        setStatus: input.setStatus,
      })
      if (settlement.cleanupError) {
        input.notify(
          `停止任务时清理状态失败：${errText(settlement.cleanupError)}`,
          'error',
        )
      }
      return settlement
    },
    [
      input.activeQueueTurnOf,
      input.applySessionSnapshot,
      input.clearLiveActivities,
      input.clearLiveProcess,
      input.clearQueueDrain,
      input.clearRunTasks,
      input.controller,
      input.currentIdRef,
      input.notify,
      input.queueTurnMatchesActivity,
      input.refs.abort,
      input.refs.currentTurnId,
      input.refs.currentTurnJobId,
      input.refs.currentTurnRevision,
      input.refs.deliveredSteers,
      input.refs.inFlightConfirmation,
      input.releaseActivity,
      input.removeSteers,
      input.setMessages,
      input.setStatus,
      input.settleSession,
      input.transitionSessionJob,
      input.turnMatchesActivity,
    ],
  )
  return settleInterruptedSession
}
