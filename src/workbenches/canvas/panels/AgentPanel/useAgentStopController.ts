import { useCallback, type MutableRefObject } from 'react'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'
import type { AgentPanelStatus } from './AgentActivityViews'
import type { AgentInterruptionSettlementResult } from './agentInterruptSettlement'

export type AgentStop = () => Promise<void>

/**
 * 「停止本回合」的 React 装配层。
 *
 * 与 `cancel`（确认卡上的取消）的区别：
 * - 用**自己的** `stoppingRef`，**故意不看 `confirmingRef`** —— 正在确认时
 *   也要能按停止，否则用户只能干等。
 * - settle 用 `'interrupted'`（cancel 用 `'canceled'`），两者对 Job / 可恢复性的
 *   语义由 `settleAgentInterruption` 内部决定，这里不许改写。
 * - 只有 `!cleanupError` 才提示"排队任务保留"；清理失败时必须闭嘴，
 *   否则用户以为收尾干净了。
 */
export interface AgentStopControllerInput {
  current: AgentSession | null
  status: AgentPanelStatus
  inFlightConfirmationRef: MutableRefObject<
    Map<string, AgentToolRequest>
  >
  stoppingRef: MutableRefObject<Set<string>>
  settleInterruptedSession: (
    session: AgentSession,
    request: AgentToolRequest | undefined,
    result: 'canceled' | 'interrupted',
  ) => Promise<AgentInterruptionSettlementResult>
  notify: (message: string, tone?: 'info' | 'error') => void
  trackRun: TaskLifecycle['track']
}

export function useAgentStopController(
  input: AgentStopControllerInput,
): AgentStop {
  return useCallback<AgentStop>(() => {
    if (!input.current || input.stoppingRef.current.has(input.current.id)) {
      return Promise.resolve()
    }
    const session = input.current
    input.stoppingRef.current.add(session.id)
    // 有正在跑的确认时优先取消那一次；否则用确认卡上的 request。
    const request =
      input.inFlightConfirmationRef.current.get(session.id) ??
      (input.status.kind === 'awaitingConfirm'
        ? input.status.request
        : undefined)
    return input.trackRun(async () => {
      try {
        const settled = await input.settleInterruptedSession(
          session,
          request,
          'interrupted',
        )
        if (
          !settled.cleanupError &&
          (session.queuedTurns?.length ?? 0) > 0
        ) {
          input.notify(
            '当前回合已停止，排队任务保留；可从队列手动继续',
            'info',
          )
        }
      } finally {
        input.stoppingRef.current.delete(session.id)
      }
    })
  }, [
    input.current,
    input.inFlightConfirmationRef,
    input.notify,
    input.settleInterruptedSession,
    input.status,
    input.stoppingRef,
    input.trackRun,
  ])
}
