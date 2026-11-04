import { useCallback, useRef } from 'react'
import { confirmationRequiresExplicitApproval } from '../../../../domain/agent/confirmation'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentPanelStatus } from './AgentActivityViews'

export interface AgentAutoRunControllerInput {
  current: AgentSession | null
  statusFor: (sessionId: string) => AgentPanelStatus
  patchSession: (
    sessionId: string,
    patch: { autoRun: boolean },
  ) => Promise<AgentSession | null>
  confirmLatest: () => Promise<unknown>
  isCurrentSession: (sessionId: string) => boolean
}

export interface AgentAutoRunController {
  setAutoRun: (autoRun: boolean) => Promise<boolean>
  autoRunFor: (sessionId: string) => boolean
  syncFromSession: (session: AgentSession) => void
  clearAutoRuns: () => void
}

export function useAgentAutoRunController(
  input: AgentAutoRunControllerInput,
): AgentAutoRunController {
  const autoRunRef = useRef(new Map<string, boolean>())

  const setAutoRun = useCallback(
    async (autoRun: boolean): Promise<boolean> => {
      const target = input.current
      if (!target) return false
      const previous = autoRunRef.current.has(target.id)
        ? autoRunRef.current.get(target.id) === true
        : target.autoRun === true
      const status = input.statusFor(target.id)
      const shouldConfirm =
        autoRun &&
        status.kind === 'awaitingConfirm' &&
        !confirmationRequiresExplicitApproval(
          status.request.name,
          status.request.args,
        )

      autoRunRef.current.set(target.id, autoRun)
      try {
        const updated = await input.patchSession(target.id, { autoRun })
        if (!updated) {
          autoRunRef.current.set(target.id, previous)
          return false
        }
      } catch (error) {
        autoRunRef.current.set(target.id, previous)
        throw error
      }

      if (
        shouldConfirm &&
        input.isCurrentSession(target.id)
      ) {
        const latestStatus = input.statusFor(target.id)
        if (
          latestStatus.kind === 'awaitingConfirm' &&
          !confirmationRequiresExplicitApproval(
            latestStatus.request.name,
            latestStatus.request.args,
          )
        ) {
          await input.confirmLatest()
        }
      }
      return true
    },
    [
      input.confirmLatest,
      input.current,
      input.isCurrentSession,
      input.patchSession,
      input.statusFor,
    ],
  )

  const autoRunFor = useCallback(
    (sessionId: string) => autoRunRef.current.get(sessionId) === true,
    [],
  )

  const syncFromSession = useCallback((session: AgentSession) => {
    autoRunRef.current.set(session.id, session.autoRun === true)
  }, [])

  const clearAutoRuns = useCallback(() => {
    autoRunRef.current.clear()
  }, [])

  return {
    setAutoRun,
    autoRunFor,
    syncFromSession,
    clearAutoRuns,
  }
}
