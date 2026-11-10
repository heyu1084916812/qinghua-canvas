import { useCallback, type MutableRefObject } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { PlatformKit } from '../../../../platform/ports'
import type { NoticeTone } from '../../../../domain/ui/notice'
import {
  addResearchCandidateToProject,
  type AddResearchReferenceResult,
} from './agentResearchReference'
import type { ConversationResearchItem } from './conversation'

export function useAgentResearchReferenceController(input: {
  platform: PlatformKit
  projectId: string
  current: AgentSession | null
  currentIdRef: MutableRefObject<string | null>
  appendReferenceIds: (
    sessionId: string,
    ids: readonly string[],
  ) => Promise<AgentSession | null>
  applySessionSnapshot: (session: AgentSession) => void
  notify: (message: string, tone?: NoticeTone) => void
}) {
  return useCallback(
    async (
      candidate: ConversationResearchItem,
    ): Promise<AddResearchReferenceResult> => {
      const sessionId = input.current?.id
      if (!sessionId) {
        const failed = { ok: false, message: '当前没有可用的 Agent 会话' }
        input.notify(failed.message, 'error')
        return failed
      }
      const result = await addResearchCandidateToProject(candidate, {
        platform: input.platform,
        projectId: input.projectId,
        signal: new AbortController().signal,
      })
      if (!result.ok || !result.item) {
        input.notify(result.message, 'error')
        return result
      }
      try {
        const snapshot = await input.appendReferenceIds(sessionId, [result.item.id])
        if (snapshot && input.currentIdRef.current === sessionId) {
          input.applySessionSnapshot(snapshot)
        }
        input.notify(result.message, 'info')
        return result
      } catch (error) {
        const message =
          error instanceof Error ? error.message : '参考已保存，但挂到当前会话失败'
        input.notify(message, 'error')
        return { ...result, ok: false, message }
      }
    },
    [
      input.appendReferenceIds,
      input.applySessionSnapshot,
      input.current,
      input.currentIdRef,
      input.notify,
      input.platform,
      input.projectId,
    ],
  )
}
