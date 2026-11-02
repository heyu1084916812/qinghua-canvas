import {
  useCallback,
  type MutableRefObject,
} from 'react'
import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import { isAgentToolName } from '../../../../domain/agent/toolRegistry'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentTurnOrigin } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopOutcome } from '../../agent/agentLoop'
import {
  IDLE_STATUS,
  type AgentPanelStatus,
} from './AgentActivityViews'
import {
  coordinateAgentOutcome,
  type AgentOutcomeMessageReveal,
} from './agentOutcomeCoordinator'
import type { PersistedAgentUserTurn } from './agentTurnPersistence'
import { activeQueueTurnOf } from '../../../../features/canvas/agent/sessionActivity'

export interface AgentOutcomeCoordinatorHookInput {
  currentIdRef: MutableRefObject<string | null>
  abortRefs: MutableRefObject<Map<string, AbortController>>
  deliveredSteersRef: MutableRefObject<Map<string, Set<string>>>
  turnToolsRef: MutableRefObject<
    Map<string, readonly ToolDeclaration[]>
  >
  sessions: AgentController['sessions']
  refresh(): Promise<unknown>
  transitionSessionJob: AgentController['transition']
  clearLiveActivitiesFor: (sessionId: string) => void
  clearLiveProcessFor: (sessionId: string) => void
  clearRunTasksFor: (sessionId: string) => void
  setMessageReveal: (
    reveal: AgentOutcomeMessageReveal | null,
  ) => void
  setMessages: (messages: ChatMessage[]) => void
  applySessionSnapshot: (session: AgentSession) => void
  setStatusFor: (sessionId: string, status: AgentPanelStatus) => void
  turnOriginFor: (
    session: AgentSession,
    persistedTurn: PersistedAgentUserTurn | undefined,
  ) => AgentTurnOrigin
}

/**
 * React 装配层：只把 refs、会话存储和 UI 回调接到纯 outcome 协调器上。
 * 业务顺序与状态映射都在 `agentOutcomeCoordinator.ts`。
 */
export function useAgentOutcomeCoordinator(
  input: AgentOutcomeCoordinatorHookInput,
) {
  const {
    currentIdRef,
    abortRefs,
    deliveredSteersRef,
    turnToolsRef,
    sessions,
    refresh,
    transitionSessionJob,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    setMessageReveal,
    setMessages,
    applySessionSnapshot,
    setStatusFor,
    turnOriginFor,
  } = input

  return useCallback(
    async (
      session: AgentSession,
      outcome: AgentLoopOutcome,
      persistedTurn: PersistedAgentUserTurn | undefined,
      outcomeController: AbortController,
    ) =>
      coordinateAgentOutcome({
        session,
        outcome,
        persistedTurn,
        outcomeController,
        turnOrigin: turnOriginFor(session, persistedTurn),
        currentOutcomeController: () =>
          abortRefs.current.get(session.id),
        currentSessionId: () => currentIdRef.current,
        sessions: {
          applyOutcome: (sessionId, apply) =>
            sessions.applyAgentOutcome(sessionId, apply),
          settleInterruptedConfirmation: (sessionId, request) =>
            sessions.settleInterruptedConfirmation(
              sessionId,
              request,
            ),
          refreshSession: async () => {
            await refresh()
          },
        },
        transitionSessionJob,
        clearLiveActivities: () =>
          clearLiveActivitiesFor(session.id),
        clearLiveProcess: () => clearLiveProcessFor(session.id),
        clearRunTasks: () => clearRunTasksFor(session.id),
        setMessageReveal,
        setMessages,
        applySessionSnapshot,
        setStatusFor,
        idleStatus: IDLE_STATUS,
        deleteAbortController: (sessionId, controller) => {
          if (abortRefs.current.get(sessionId) === controller) {
            abortRefs.current.delete(sessionId)
          }
        },
        turnToolNames: () =>
          (turnToolsRef.current.get(session.id) ?? [])
            .map((tool) => tool.name)
            .filter(isAgentToolName),
        deliveredSteerIds: () => [
          ...(deliveredSteersRef.current.get(session.id) ?? []),
        ],
        clearDeliveredSteers: () =>
          deliveredSteersRef.current.delete(session.id),
        activeQueuedTurnId: () => activeQueueTurnOf(session.id),
        prefersReducedMotion: () =>
          window.matchMedia(
            '(prefers-reduced-motion: reduce)',
          ).matches,
      }),
    [
      abortRefs,
      refresh,
      applySessionSnapshot,
      clearLiveActivitiesFor,
      clearLiveProcessFor,
      clearRunTasksFor,
      currentIdRef,
      deliveredSteersRef,
      sessions,
      setMessageReveal,
      setMessages,
      setStatusFor,
      transitionSessionJob,
      turnOriginFor,
      turnToolsRef,
    ],
  )
}
