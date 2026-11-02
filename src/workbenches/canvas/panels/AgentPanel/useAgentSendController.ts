import { useCallback, type MutableRefObject } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { beforeAgentSendFlow, runAgentSendFlow } from './agentSendFlow'
import type { AgentSendText } from './useAgentQueueController'

export interface AgentSendControllerInput {
  current: AgentSession | null
  currentIdRef: MutableRefObject<string | null>
  stickToLatestRef: MutableRefObject<boolean>
  setShowJumpToLatest: (value: boolean) => void
  controller: Parameters<typeof runAgentSendFlow>[0]['controller']
  abortRefs: MutableRefObject<Map<string, AbortController>>
  deliveredSteersRef: MutableRefObject<Map<string, Set<string>>>
  runSendText: (
    text: string,
    session: AgentSession,
    turnId?: string,
    internalControl?: boolean,
  ) => ReturnType<Parameters<typeof runAgentSendFlow>[0]['runTurn']>
  applySessionSnapshot: (session: AgentSession) => void
  clearLiveActivitiesFor: (sessionId: string) => void
  clearLiveProcessFor: (sessionId: string) => void
  clearRunTasksFor: (sessionId: string) => void
  setStatusFor: Parameters<typeof runAgentSendFlow>[0]['setStatusFor']
  transitionSessionJob: Parameters<typeof runAgentSendFlow>[0]['transitionSessionJob']
  queuePumpRef: MutableRefObject<(sessionId: string) => void>
}

/**
 * React 发送协调边界：把当前会话解析和跟随滚动留在宿主，所有会话锁、
 * 队列结算与异常收尾由纯发送流统一处理。这里不产生新的运行态副本。
 */
export function useAgentSendController({
  current,
  currentIdRef,
  stickToLatestRef,
  setShowJumpToLatest,
  controller,
  abortRefs,
  deliveredSteersRef,
  runSendText,
  applySessionSnapshot,
  clearLiveActivitiesFor,
  clearLiveProcessFor,
  clearRunTasksFor,
  setStatusFor,
  transitionSessionJob,
  queuePumpRef,
}: AgentSendControllerInput): AgentSendText {
  return useCallback(
    async (
      raw: string,
      queuedSession?: AgentSession,
      opts: {
        preclaimed?: boolean
        queueTurnId?: string
        internalControl?: boolean
      } = {},
    ) => {
      const text = raw.trim()
      const session = queuedSession ?? current
      if (!text || !session) return undefined
      beforeAgentSendFlow(
        session.id,
        currentIdRef.current,
        () => {
          stickToLatestRef.current = true
          setShowJumpToLatest(false)
        },
      )
      return runAgentSendFlow({
        session,
        text,
        controller,
        abortRefs,
        deliveredSteersRef,
        preclaimed: opts.preclaimed,
        queueTurnId: opts.queueTurnId,
        internalControl: opts.internalControl,
        runTurn: runSendText,
        applySessionSnapshot,
        clearLiveActivitiesFor,
        clearLiveProcessFor,
        clearRunTasksFor,
        setStatusFor,
        transitionSessionJob,
        queuePump: (sessionId) => queuePumpRef.current(sessionId),
      })
    },
    [
      abortRefs,
      applySessionSnapshot,
      clearLiveActivitiesFor,
      clearLiveProcessFor,
      clearRunTasksFor,
      controller,
      current,
      currentIdRef,
      deliveredSteersRef,
      queuePumpRef,
      runSendText,
      setShowJumpToLatest,
      setStatusFor,
      stickToLatestRef,
      transitionSessionJob,
    ],
  )
}
