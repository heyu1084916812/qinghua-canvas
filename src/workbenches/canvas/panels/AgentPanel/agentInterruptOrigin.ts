import type { AgentTurnOrigin } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'

/** origin 只读这三张 per-session 表；不持有、不复制任何会话真相。 */
export interface AgentTurnOriginRefs {
  currentTurnJobId: { readonly current: Map<string, string> }
  currentTurnId: { readonly current: Map<string, string> }
  currentTurnRevision: { readonly current: Map<string, number> }
}

/**
 * 一个回合在宿主里留下的六张 per-session 表。
 *
 * 停止收口必须**六张一起清**：少清 abort 会让旧信号继续生效，少清
 * deliveredSteers / inFlightConfirmation 会让迟到的引导或旧确认卡复活，
 * 少清 currentTurn* 会让下一次发送拿到上一轮的 Job / revision 屏障。
 */
export interface AgentTurnRefMaps {
  abort: { readonly current: Map<string, AbortController> }
  deliveredSteers: { readonly current: Map<string, Set<string>> }
  inFlightConfirmation: { readonly current: Map<string, AgentToolRequest> }
  currentTurnId: { readonly current: Map<string, string> }
  currentTurnJobId: { readonly current: Map<string, string> }
  currentTurnRevision: { readonly current: Map<string, number> }
}

/** Controller 侧只用来兜底：面板 ref 里没有时才问它。 */
export interface AgentTurnOriginLookup {
  jobId(sessionId: string): string | undefined
  turnId(sessionId: string): string | undefined
}

/**
 * 停止 / 取消用的回合 origin。
 *
 * 三元回退是**业务口径**，不是可选优化：队列回合优先（queueTurnId），其次本轮
 * ref，最后才问 controller。`messageRevision` 必须优先取会话上的持久值 ——
 * 它下游被当作停止屏障的 CAS 期望值（`settleAgentInterruption` 传给
 * `settleSession` 的 `expectedRevision`），读晚了或读错了一律拿旧回合的号去挡新回合。
 */
export function interruptOriginFor(input: {
  session: AgentSession
  refs: AgentTurnOriginRefs
  controller: AgentTurnOriginLookup
  activeQueueTurnOf: (sessionId: string) => string | undefined
}): AgentTurnOrigin {
  const { session, refs, controller, activeQueueTurnOf } = input
  const queueTurnId = activeQueueTurnOf(session.id)
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
      session.messageRevision ??
      refs.currentTurnRevision.current.get(session.id),
  }
}

/** 回合收口后清空它的六张 per-session 表；只删目标会话，不碰别人的。 */
export function clearTurnRefs(
  refs: AgentTurnRefMaps,
  sessionId: string,
): void {
  refs.abort.current.delete(sessionId)
  refs.deliveredSteers.current.delete(sessionId)
  refs.inFlightConfirmation.current.delete(sessionId)
  refs.currentTurnId.current.delete(sessionId)
  refs.currentTurnJobId.current.delete(sessionId)
  refs.currentTurnRevision.current.delete(sessionId)
}
