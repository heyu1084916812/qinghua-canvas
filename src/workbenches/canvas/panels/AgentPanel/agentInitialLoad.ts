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
  /**
   * 孤儿会话（启动时建出来、随后被用户接管而丢弃的那条）删除失败时的**一次性**提示。
   *
   * 由面板注入：模块自己不碰 store / logger，也不逐次重试都弹一条。
   */
  notifyCleanupFailure?: (message: string) => void
  /** 结构化日志：带 sessionId 与最终错误，便于事后定位。 */
  logCleanupFailure?: (detail: {
    sessionId: string
    attempts: number
    error: unknown
  }) => void
  /** 重试间隔（测试可注入立即返回的实现，避免真等）。 */
  wait?: (ms: number) => Promise<void>
}

/** 孤儿清理最多尝试 3 次（首次 + 2 次重试）。 */
export const AGENT_ORPHAN_CLEANUP_ATTEMPTS = 3
export const AGENT_ORPHAN_CLEANUP_RETRY_DELAY_MS = 150
export const AGENT_ORPHAN_CLEANUP_FAILURE_MESSAGE =
  '启动时清理多余的 Agent 会话失败：它暂时还留在列表里，可以手动删除。'

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * 删掉被丢弃的空会话，失败就小退后再试。
 *
 * 清理是**旁路**：这里只负责「多试两次」，最终仍失败由调用方收口成
 * 一次提示 + 一条日志，绝不上抛去打断启动。
 */
async function removeDiscardedSession(
  input: AgentInitialLoadInput,
  sessionId: string,
): Promise<void> {
  const wait = input.wait ?? defaultWait
  let lastError: unknown
  for (let attempt = 1; attempt <= AGENT_ORPHAN_CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      await input.removeSession(sessionId)
      return
    } catch (error) {
      lastError = error
      if (attempt < AGENT_ORPHAN_CLEANUP_ATTEMPTS) {
        await wait(AGENT_ORPHAN_CLEANUP_RETRY_DELAY_MS)
      }
    }
  }
  throw lastError
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
      await removeDiscardedSession(input, created.id)
      return { kind: 'stale', discardedSessionId: created.id }
    } catch (cleanupError) {
      /**
       * 重试也没删掉：**提示一次**、记一条带 sessionId 的日志，
       * 然后照常返回 stale —— 清理失败绝不能阻断启动或正常会话加载。
       */
      input.logCleanupFailure?.({
        sessionId: created.id,
        attempts: AGENT_ORPHAN_CLEANUP_ATTEMPTS,
        error: cleanupError,
      })
      input.notifyCleanupFailure?.(AGENT_ORPHAN_CLEANUP_FAILURE_MESSAGE)
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
