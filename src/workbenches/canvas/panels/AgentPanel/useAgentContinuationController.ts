import { useCallback, type MutableRefObject } from 'react'
import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopDeps } from '../../agent/agentLoop'
import type { AgentPanelStatus } from './AgentActivityViews'
import type {
  AgentContinuationLoopDepsInput,
  AgentContinuationRunInput,
} from './agentContinuationRun'

export type AgentContinueTask = () => Promise<void>

/**
 * 「轮数预算暂停后继续」的 React 装配层。
 *
 * 这一条**故意不加锁**：防重靠 `runAgentContinuation` 内部的原子
 * `claimSessionActivity`（队列回合还会先 `claimNextQueuedTurn` 拿到 token 再绑
 * turnId）。在这里再加一把 session 锁会挡掉合法重试，行为反而变差。
 *
 * 三个必须"调用即取"的端口：
 * - `turnOrigin(turnId, queueTurnId)`：参数由 continuation 决定，job/revision 现读 ref；
 * - `toolMode()` / `turnTools()`：续跑要沿用**本回合**的 tools，不是面板此刻的。
 */
export interface AgentContinuationControllerInput {
  current: AgentSession | null
  status: AgentPanelStatus
  messages: readonly ChatMessage[]
  /** Store port bound to the target session; never derive history from the visible composer. */
  sessions?: {
    messagesFor: (sessionId: string) => Promise<readonly ChatMessage[]>
  }
  sessionBrief?: (messages: readonly ChatMessage[]) => string | undefined
  localRevision?: number
  sessionRevision?: number
  controller: Pick<
    AgentController,
    'jobId' | 'turnId' | 'claimNextQueuedTurn'
  >
  activeQueueTurnOf: (sessionId: string) => string | undefined
  currentTurnJobIdRef: MutableRefObject<Map<string, string>>
  currentTurnIdRef: MutableRefObject<Map<string, string>>
  currentTurnRevisionRef: MutableRefObject<Map<string, number>>
  isActivityActive: (sessionId: string) => boolean
  claimActivity: AgentContinuationRunInput['claimActivity']
  applySessionSnapshot: AgentContinuationRunInput['applySessionSnapshot']
  ensureRoute: AgentContinuationRunInput['ensureRoute']
  loopDeps: (args: AgentContinuationLoopDepsInput) => AgentLoopDeps
  toolModeRef: MutableRefObject<Map<string, 'native' | 'json'>>
  turnToolsForSession: (
    session: AgentSession,
  ) => readonly ToolDeclaration[]
  transitionSessionJob: AgentContinuationRunInput['transitionSessionJob']
  abortRefs: MutableRefObject<Map<string, AbortController>>
  setStatusFor: (
    sessionId: string,
    status: AgentPanelStatus,
  ) => void
  runAgentTurn: AgentContinuationRunInput['runAgentTurn']
  continueAutoConfirmations: AgentContinuationRunInput['continueAutoConfirmations']
  handleOutcome: AgentContinuationRunInput['handleOutcome']
  settleSessionOutcome: AgentContinuationRunInput['settleSessionOutcome']
  currentIdRef: MutableRefObject<string | null>
  setMessages: (messages: ChatMessage[]) => void
  trackRun: TaskLifecycle['track']
  runContinuation: (input: AgentContinuationRunInput) => Promise<unknown>
}

export function useAgentContinuationController(
  input: AgentContinuationControllerInput,
): AgentContinueTask {
  return useCallback<AgentContinueTask>(() => {
    if (!input.current || input.status.kind !== 'paused') {
      return Promise.resolve()
    }
    const target = input.current
    return input.trackRun(async () => {
      await input.runContinuation({
        session: target,
        messages: input.messages,
        ...(input.sessions ? { sessions: input.sessions } : {}),
        ...(input.sessionBrief ? { sessionBrief: input.sessionBrief } : {}),
        ...(input.localRevision === undefined
          ? {}
          : { localRevision: input.localRevision }),
        ...(input.sessionRevision === undefined
          ? {}
          : { sessionRevision: input.sessionRevision }),
        activeQueueTurnId: () => input.activeQueueTurnOf(target.id),
        currentTurnId: () =>
          input.currentTurnIdRef.current.get(target.id) ??
          input.controller.turnId(target.id),
        turnOrigin: (turnId, queueTurnId) => ({
          jobId:
            input.currentTurnJobIdRef.current.get(target.id) ??
            input.controller.jobId(target.id),
          turnId: turnId ?? input.controller.turnId(target.id),
          queueTurnId,
          messageRevision:
            target.messageRevision ??
            input.currentTurnRevisionRef.current.get(target.id),
        }),
        isActivityActive: () => input.isActivityActive(target.id),
        claimNextQueuedTurn: input.controller.claimNextQueuedTurn,
        claimActivity: input.claimActivity,
        applySessionSnapshot: input.applySessionSnapshot,
        ensureRoute: input.ensureRoute,
        createLoopDeps: (args) => input.loopDeps(args),
        toolMode: () =>
          input.toolModeRef.current.get(target.id) ?? 'native',
        turnTools: () => input.turnToolsForSession(target),
        transitionSessionJob: input.transitionSessionJob,
        setAbortController: (continuationAbort) => {
          input.abortRefs.current.set(target.id, continuationAbort)
        },
        setStatus: (next) => input.setStatusFor(target.id, next),
        runAgentTurn: input.runAgentTurn,
        continueAutoConfirmations: input.continueAutoConfirmations,
        handleOutcome: input.handleOutcome,
        settleSessionOutcome: input.settleSessionOutcome,
        isCurrentSession: () =>
          input.currentIdRef.current === target.id,
        setMessages: input.setMessages,
      })
    })
  }, [
    input.abortRefs,
    input.activeQueueTurnOf,
    input.applySessionSnapshot,
    input.claimActivity,
    input.continueAutoConfirmations,
    input.controller,
    input.current,
    input.currentIdRef,
    input.currentTurnIdRef,
    input.currentTurnJobIdRef,
    input.currentTurnRevisionRef,
    input.ensureRoute,
    input.handleOutcome,
    input.isActivityActive,
    input.loopDeps,
    input.messages,
    input.localRevision,
    input.sessionBrief,
    input.sessionRevision,
    input.sessions,
    input.runAgentTurn,
    input.runContinuation,
    input.setMessages,
    input.settleSessionOutcome,
    input.setStatusFor,
    input.status,
    input.toolModeRef,
    input.trackRun,
    input.transitionSessionJob,
    input.turnToolsForSession,
  ])
}
