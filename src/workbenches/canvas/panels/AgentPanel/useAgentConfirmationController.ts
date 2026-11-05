import { useCallback, type MutableRefObject } from 'react'
import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'
import type { AgentLoopDeps } from '../../agent/agentLoop'
import type { AgentPanelStatus } from './AgentActivityViews'
import type {
  AgentConfirmationLoopDepsInput,
  AgentConfirmationRunInput,
} from './agentConfirmationRun'
import { interruptOriginFor } from './agentInterruptOrigin'
import type { AgentInterruptionSettlementResult } from './agentInterruptSettlement'

export type AgentConfirm = () => Promise<void>
export type AgentCancel = () => Promise<void>

/**
 * 确认卡的两个动作（确认 / 取消）的 React 装配层。
 *
 * 铁律（测试逐条钉住，别为了"顺手统一"改掉）：
 * 1. **锁在 `trackRun` 之外、同步 add**：同一 tick 连点只能进一次；释放只在内层
 *    `finally`，成功失败都要放。
 * 2. **`inFlightConfirmationRef` 只按 callId 清**：连续两次确认时，后一次的记录
 *    不能被前一次的 `finally` 抹掉，否则 `stop` 拿不到 request，
 *    历史里留下悬空的 `tool_call`。
 * 3. **快照语义**：`session` / `request` / `messages` 都是点击那一刻的值；
 *    中途切会话仍打原会话。
 * 4. `confirm` 与 `cancel` **共用 `confirmingRef`**，所以两者互斥；`stop` 不在此列。
 */
export interface AgentConfirmationControllerInput {
  current: AgentSession | null
  status: AgentPanelStatus
  messages: readonly ChatMessage[]
  confirmingRef: MutableRefObject<Set<string>>
  inFlightConfirmationRef: MutableRefObject<Map<string, AgentToolRequest>>
  currentTurnJobIdRef: MutableRefObject<Map<string, string>>
  currentTurnIdRef: MutableRefObject<Map<string, string>>
  currentTurnRevisionRef: MutableRefObject<Map<string, number>>
  activeQueueTurnOf: (sessionId: string) => string | undefined
  controller: Pick<
    AgentController,
    'jobId' | 'turnId' | 'beginConfirmation' | 'finishConfirmedTool'
  >
  runConfirmation: (input: AgentConfirmationRunInput) => Promise<unknown>
  executeConfirmedTool: AgentConfirmationRunInput['executeConfirmedTool']
  ensureRoute: AgentConfirmationRunInput['ensureRoute']
  loopDeps: (args: AgentConfirmationLoopDepsInput) => AgentLoopDeps
  toolModeRef: MutableRefObject<Map<string, 'native' | 'json'>>
  turnToolsForSession: (
    session: AgentSession,
  ) => readonly ToolDeclaration[]
  resumeAgentTurn: AgentConfirmationRunInput['resumeAgentTurn']
  continueAutoConfirmations: AgentConfirmationRunInput['continueAutoConfirmations']
  handleOutcome: AgentConfirmationRunInput['handleOutcome']
  settleSessionOutcome: AgentConfirmationRunInput['settleSessionOutcome']
  transitionSessionJob: AgentConfirmationRunInput['transitionSessionJob']
  abortRefs: MutableRefObject<Map<string, AbortController>>
  currentIdRef: MutableRefObject<string | null>
  setStatusFor: (
    sessionId: string,
    status: AgentPanelStatus,
  ) => void
  setMessages: (messages: ChatMessage[]) => void
  settleInterruptedSession: (
    session: AgentSession,
    request: AgentToolRequest | undefined,
    result: 'canceled' | 'interrupted',
  ) => Promise<AgentInterruptionSettlementResult>
  trackRun: TaskLifecycle['track']
  notify: (message: string, tone?: 'info' | 'error') => void
}

export interface AgentConfirmationController {
  confirm: AgentConfirm
  cancel: AgentCancel
}

export function useAgentConfirmationController(
  input: AgentConfirmationControllerInput,
): AgentConfirmationController {
  const confirm = useCallback<AgentConfirm>(() => {
    if (input.status.kind !== 'awaitingConfirm' || !input.current) {
      return Promise.resolve()
    }
    const target = input.current
    // 同步占锁：同一 tick 的第二次点击必须立刻返回，不能等 await。
    if (input.confirmingRef.current.has(target.id)) {
      return Promise.resolve()
    }
    input.confirmingRef.current.add(target.id)
    const { request } = input.status
    return input.trackRun(async () => {
      try {
        input.inFlightConfirmationRef.current.set(target.id, request)
        await input.runConfirmation({
          session: target,
          request,
          messages: input.messages,
          // 与本回合 stop / 引导同一套 origin 口径（queueTurnId 优先）。
          turnOrigin: () =>
            interruptOriginFor({
              session: target,
              refs: {
                currentTurnJobId: input.currentTurnJobIdRef,
                currentTurnId: input.currentTurnIdRef,
                currentTurnRevision: input.currentTurnRevisionRef,
              },
              controller: input.controller,
              activeQueueTurnOf: input.activeQueueTurnOf,
            }),
          beginConfirmation: input.controller.beginConfirmation,
          finishConfirmedTool: input.controller.finishConfirmedTool,
          executeConfirmedTool: input.executeConfirmedTool,
          ensureRoute: input.ensureRoute,
          createLoopDeps: (args) => input.loopDeps(args),
          toolMode: () =>
            input.toolModeRef.current.get(target.id) ?? 'native',
          turnTools: () => input.turnToolsForSession(target),
          resumeAgentTurn: input.resumeAgentTurn,
          continueAutoConfirmations: input.continueAutoConfirmations,
          handleOutcome: input.handleOutcome,
          settleSessionOutcome: input.settleSessionOutcome,
          transitionSessionJob: input.transitionSessionJob,
          setAbortController: (confirmationAbort) => {
            input.abortRefs.current.set(target.id, confirmationAbort)
          },
          setStatus: (next) => input.setStatusFor(target.id, next),
          isCurrentSession: () =>
            input.currentIdRef.current === target.id,
          setMessages: input.setMessages,
        })
      } finally {
        input.confirmingRef.current.delete(target.id)
        // 只清自己那一条：后来者已经换上新的 request 时必须留着。
        if (
          input.inFlightConfirmationRef.current.get(target.id)?.callId ===
          request.callId
        ) {
          input.inFlightConfirmationRef.current.delete(target.id)
        }
      }
    })
  }, [
    input.abortRefs,
    input.activeQueueTurnOf,
    input.continueAutoConfirmations,
    input.confirmingRef,
    input.controller,
    input.current,
    input.currentIdRef,
    input.currentTurnIdRef,
    input.currentTurnJobIdRef,
    input.currentTurnRevisionRef,
    input.ensureRoute,
    input.executeConfirmedTool,
    input.handleOutcome,
    input.inFlightConfirmationRef,
    input.loopDeps,
    input.messages,
    input.runConfirmation,
    input.resumeAgentTurn,
    input.setMessages,
    input.settleSessionOutcome,
    input.setStatusFor,
    input.status,
    input.toolModeRef,
    input.trackRun,
    input.transitionSessionJob,
    input.turnToolsForSession,
  ])

  const cancel = useCallback<AgentCancel>(() => {
    if (input.status.kind !== 'awaitingConfirm' || !input.current) {
      return Promise.resolve()
    }
    const target = input.current
    if (input.confirmingRef.current.has(target.id)) {
      return Promise.resolve()
    }
    input.confirmingRef.current.add(target.id)
    const { request } = input.status
    return input.trackRun(async () => {
      try {
        const settled = await input.settleInterruptedSession(
          target,
          request,
          'canceled',
        )
        // 清理失败时不报"已取消"，否则用户以为干净收尾了。
        if (!settled.cleanupError) {
          input.notify(
            '已取消；本次没有执行工具，也不会自动新增节点',
            'info',
          )
        }
      } finally {
        input.confirmingRef.current.delete(target.id)
      }
    })
  }, [
    input.confirmingRef,
    input.current,
    input.notify,
    input.settleInterruptedSession,
    input.status,
    input.trackRun,
  ])

  return { confirm, cancel }
}
