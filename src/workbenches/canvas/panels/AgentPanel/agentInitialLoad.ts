import type { MutableRefObject } from 'react'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentSessionRefreshResult } from './useAgentSessionLifecycle'

export interface AgentInitialLoadInput {
  isAlive: () => boolean
  currentIdRef: MutableRefObject<string | null>
  selectionVersionRef: MutableRefObject<number>
  refresh: () => Promise<AgentSessionRefreshResult>
  loadReviewModel: () => Promise<string | null>
  loadCanvasReview: () => Promise<boolean>
  setReviewModel: (model: string) => void
  setCanvasReview: (enabled: boolean) => void
  getSession: (sessionId: string) => Promise<AgentSession | null>
  createSession: (
    canCommit: () => boolean,
  ) => Promise<AgentSession | null>
  removeSession: (sessionId: string) => Promise<void>
  setList: (sessions: AgentSession[]) => void
  setCurrent: (session: AgentSession) => void
  setMessages: (messages: ChatMessage[]) => void
}

export type AgentInitialLoadOutcome =
  | {
      kind: 'stale'
      discardedSessionId?: string
      cleanupError?: unknown
    }
  | { kind: 'loaded'; session: AgentSession }
  | { kind: 'created'; session: AgentSession }

/**
 * Restores the initial session only while it still owns the selection.
 * Any user-driven list/current change advances selectionVersionRef.
 */
export async function runAgentInitialLoad(
  input: AgentInitialLoadInput,
): Promise<AgentInitialLoadOutcome> {
  const refreshed = await input.refresh()
  if (!refreshed.applied || !input.isAlive()) return { kind: 'stale' }

  const version = input.selectionVersionRef.current
  const stillOwnsSelection = () =>
    input.isAlive() &&
    input.currentIdRef.current === null &&
    input.selectionVersionRef.current === version

  if (!stillOwnsSelection()) return { kind: 'stale' }

  const [savedReviewModel, savedCanvasReview] = await Promise.all([
    input.loadReviewModel(),
    input.loadCanvasReview(),
  ])
  if (!stillOwnsSelection()) return { kind: 'stale' }
  input.setReviewModel(savedReviewModel ?? '')
  input.setCanvasReview(savedCanvasReview)

  if (refreshed.rows.length > 0) {
    const head = refreshed.rows[0]!
    const loaded =
      (await input.getSession(head.id).catch(() => null)) ?? head
    if (!stillOwnsSelection()) return { kind: 'stale' }
    input.setCurrent(loaded)
    input.setMessages(loaded.messages)
    return { kind: 'loaded', session: loaded }
  }

  if (!stillOwnsSelection()) return { kind: 'stale' }
  const created = await input.createSession(stillOwnsSelection)
  if (!created) return { kind: 'stale' }
  if (!stillOwnsSelection()) {
    try {
      await input.removeSession(created.id)
      return { kind: 'stale', discardedSessionId: created.id }
    } catch (cleanupError) {
      return {
        kind: 'stale',
        discardedSessionId: created.id,
        cleanupError,
      }
    }
  }
  input.setList([created])
  input.setCurrent(created)
  input.setMessages([])
  return { kind: 'created', session: created }
}
