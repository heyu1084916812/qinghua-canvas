import type { AgentTurnOrigin } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type {
  AgentTurnOriginLookup,
  AgentTurnOriginRefs,
} from './agentInterruptOrigin'
import type { PersistedAgentUserTurn } from './agentTurnPersistence'

export interface OutcomeTurnOriginInput {
  persistedTurn: PersistedAgentUserTurn | undefined
  session: AgentSession
  refs: AgentTurnOriginRefs
  controller: AgentTurnOriginLookup
  activeQueueTurnOf: (sessionId: string) => string | undefined
}

/**
 * 结果收口（`handleOutcome`）用的回合 origin。
 *
 * 与 `interruptOriginFor`（停止/取消）同源，只多一层 revision 优先级：
 *   messageRevision = persistedTurn?.messageRevision
 *                  ?? session.messageRevision
 *                  ?? currentTurnRevisionRef
 *
 * 为什么 persistedTurn 必须优先：收口要拿"用户消息落库之后"的 revision 做 CAS。
 * 用发消息那一刻的旧 revision（session 或 ref）会撞上自己的写入，表现为本该成功
 * 的一次写入被判成冲突、消息被丢弃。三层顺序是刻意的，别合并。
 *
 * jobId / turnId / queueTurnId 的链路与停止完全一致：队列回合优先，其次本轮
 * ref，最后才问 controller。
 */
export function outcomeTurnOriginFor(
  input: OutcomeTurnOriginInput,
): AgentTurnOrigin {
  const { session, refs, controller } = input
  const queueTurnId = input.activeQueueTurnOf(session.id)
  return {
    jobId:
      refs.currentTurnJobId.current.get(session.id) ??
      controller.jobId(session.id),
    turnId:
      queueTurnId ??
      refs.currentTurnId.current.get(session.id) ??
      controller.turnId(session.id),
    queueTurnId,
    messageRevision:
      input.persistedTurn?.messageRevision ??
      session.messageRevision ??
      refs.currentTurnRevision.current.get(session.id),
  }
}
