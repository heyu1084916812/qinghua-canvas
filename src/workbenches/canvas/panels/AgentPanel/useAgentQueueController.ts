import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { AgentLoopOutcome } from '../../agent/agentLoop'
import { errText } from '../../agent/agentLoop'
import {
  sessionForQueuedTurn,
  type QueuedAgentTurn,
} from '../../../../domain/agent/queuedTurn'
import type {
  AgentController,
  AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
import {
  bindQueueTurnToSessionActivity,
  claimSessionActivity,
  clearQueueDrain,
  releaseSessionActivity,
  requestQueueDrain,
  shouldDrainQueue,
  subscribeSessionRelease,
  turnMatchesSessionActivity,
} from '../../../../features/canvas/agent/sessionActivity'
import { createId } from '../../../../shared/id'
import type {
  AgentSession,
  AgentSessionStore,
} from '../../../../state/agent/sessionStore'
import {
  TaskLifecycleClosedError,
  type TaskLifecycle,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentPanelStatus } from './AgentActivityViews'

export type AgentSendText = (
  raw: string,
  queuedSession?: AgentSession,
  opts?: {
    preclaimed?: boolean
    queueTurnId?: string
    internalControl?: boolean
  },
) => Promise<AgentLoopOutcome | undefined>

export interface AgentQueueControllerInput {
  current: AgentSession | null
  currentIdRef: MutableRefObject<string | null>
  status: AgentPanelStatus
  sessions: AgentSessionStore
  controller: AgentController
  sendText: AgentSendText
  applySessionSnapshot(session: AgentSession): void
  setStatusFor(sessionId: string, status: AgentPanelStatus): void
  setDraft: Dispatch<SetStateAction<string>>
  setQueueMenuId: Dispatch<SetStateAction<string | null>>
  refresh(): Promise<readonly AgentSession[]>
  notify(message: string, tone?: 'info' | 'error'): void
  queuePumpingRef: MutableRefObject<Set<string>>
  queuePumpRef: MutableRefObject<(sessionId: string) => void>
  trackRun: TaskLifecycle['track']
  saveDraft: (sessionId: string, text: string) => void
}

/**
 * 持久队列的 React 适配层。
 *
 * 队列的真相始终在 AgentSession / AgentController；这里只负责串行泵、编辑态和
 * 会话活动锁。不要在这里另存一份“正在跑的队列”。
 */
export function useAgentQueueController({
  current,
  currentIdRef,
  status,
  sessions,
  controller,
  sendText,
  applySessionSnapshot,
  setStatusFor,
  setDraft,
  setQueueMenuId,
  refresh,
  notify,
  queuePumpingRef,
  queuePumpRef,
  trackRun,
  saveDraft,
}: AgentQueueControllerInput) {
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null)
  const [editingQueueText, setEditingQueueText] = useState('')

  useEffect(() => {
    setEditingQueueId(null)
    setEditingQueueText('')
  }, [current?.id])

  const queueText = useCallback(
    (raw: string) =>
      trackRun(async () => {
        if (!current) return false
        const text = raw.trim()
        if (!text) return false
        const latest =
          (await sessions.get(current.id).catch(() => null)) ?? current
        if (!latest.model) {
          setStatusFor(current.id, {
            kind: 'error',
            message: '还没选模型：先在上面选一个对话模型',
          })
          return false
        }
        const turn: QueuedAgentTurn = {
          id: createId('turn'),
          text,
          createdAt: Date.now(),
          channelId: latest.channelId,
          model: latest.model,
          ...(latest.imageModel ? { imageModel: latest.imageModel } : {}),
          ...(latest.videoModel ? { videoModel: latest.videoModel } : {}),
          ...(latest.skillId ? { skillId: latest.skillId } : {}),
          ...(latest.autoRun === true ? { autoRun: true } : {}),
          ...(latest.pendingAssetIds?.length
            ? { pendingAssetIds: [...latest.pendingAssetIds] }
            : {}),
        }
        const queued = await controller.enqueueTurn(current.id, turn)
        if (!queued.ok) {
          if (queued.reason === 'full') {
            notify('排队任务已达上限，请先处理或删除队列中的任务', 'error')
          }
          return false
        }
        requestQueueDrain(current.id)
        applySessionSnapshot(queued.session)
        if (currentIdRef.current === current.id) {
          setDraft((value) => {
            const next = value.trim() === text ? '' : value
            if (next !== value) saveDraft(current.id, next)
            return next
          })
        }
        return true
      }),
    [
      applySessionSnapshot,
      controller,
      current,
      currentIdRef,
      notify,
      saveDraft,
      sessions,
      setDraft,
      setStatusFor,
      trackRun,
    ],
  )

  const removeQueued = useCallback(
    (turnId: string) =>
      trackRun(async () => {
        if (!current) return
        const next = await controller.removeQueuedTurn(current.id, turnId)
        if (next) applySessionSnapshot(next)
        setQueueMenuId((id) => (id === turnId ? null : id))
      }),
    [
      applySessionSnapshot,
      controller,
      current,
      setQueueMenuId,
      trackRun,
    ],
  )

  const beginQueueEdit = useCallback(
    (turn: QueuedAgentTurn) => {
      setQueueMenuId(null)
      setEditingQueueId(turn.id)
      setEditingQueueText(turn.text)
    },
    [setQueueMenuId],
  )

  const commitQueueEdit = useCallback(() => {
    return trackRun(async () => {
      if (!current || !editingQueueId) return
      const text = editingQueueText.trim()
      if (!text) {
        notify('消息不能为空', 'error')
        return
      }
      const next = await controller.editQueuedTurn(
        current.id,
        editingQueueId,
        text,
      )
      if (next) applySessionSnapshot(next)
      setEditingQueueId(null)
      setEditingQueueText('')
    })
  }, [
    applySessionSnapshot,
    controller,
    current,
    editingQueueId,
    editingQueueText,
    notify,
    trackRun,
  ])

  const pumpQueuedTurn = useCallback(
    (sessionId: string) =>
      trackRun(async () => {
        if (queuePumpingRef.current.has(sessionId)) return
        queuePumpingRef.current.add(sessionId)
        let claimedTurnId: string | undefined
        try {
          if (!claimSessionActivity(sessionId)) return
          const next = await controller.claimNextQueuedTurn(sessionId)
          if (!next) {
            clearQueueDrain(sessionId)
            releaseSessionActivity(sessionId)
            return
          }
          claimedTurnId = next.turn.id
          if (!bindQueueTurnToSessionActivity(sessionId, claimedTurnId)) {
            const released = await controller.finishQueuedTurn(
              sessionId,
              claimedTurnId,
              false,
            )
            if (released) applySessionSnapshot(released)
            clearQueueDrain(sessionId)
            releaseSessionActivity(sessionId, claimedTurnId)
            return
          }
          applySessionSnapshot(next.session)
          if (next.session.queuedTurns.length > 0) {
            requestQueueDrain(sessionId)
          } else {
            clearQueueDrain(sessionId)
          }
          await sendText(
            next.turn.text,
            sessionForQueuedTurn(next.session, next.turn),
            { preclaimed: true, queueTurnId: next.turn.id },
          )
        } catch (error) {
          if (claimedTurnId) {
            const released = await controller
              .finishQueuedTurn(sessionId, claimedTurnId, false)
              .catch(() => null)
            if (released) applySessionSnapshot(released)
          }
          releaseSessionActivity(sessionId, claimedTurnId)
          setStatusFor(sessionId, { kind: 'error', message: errText(error) })
        } finally {
          queuePumpingRef.current.delete(sessionId)
        }
      }),
    [
      applySessionSnapshot,
      controller,
      queuePumpingRef,
      sendText,
      setStatusFor,
      trackRun,
    ],
  )

  const pumpDetached = useCallback((sessionId: string) => {
    void pumpQueuedTurn(sessionId).catch((error) => {
      if (!(error instanceof TaskLifecycleClosedError)) {
        setStatusFor(sessionId, { kind: 'error', message: errText(error) })
      }
    })
  }, [pumpQueuedTurn, setStatusFor])

  queuePumpRef.current = (sessionId) => {
    if (!shouldDrainQueue(sessionId)) return
    pumpDetached(sessionId)
  }

  const resumeQueue = useCallback(() => {
    if (!current) return Promise.resolve()
    return trackRun(async () => {
      try {
        await refresh()
      } catch (error) {
        setStatusFor(current.id, { kind: 'error', message: errText(error) })
        return
      }
      requestQueueDrain(current.id)
      await pumpQueuedTurn(current.id)
    })
  }, [current, pumpQueuedTurn, refresh, setStatusFor, trackRun])

  const settleSessionOutcome = useCallback(
    (
      sessionId: string,
      outcome: AgentLoopOutcome | { kind: 'error' },
      origin: AgentTurnOrigin = {},
    ) =>
      trackRun(async () => {
        const kind = outcome.kind
        if (kind === 'confirm') return
        if (kind === 'stopped' && outcome.checkpoint) return
        const queueTurnId = origin.queueTurnId
        if (
          !turnMatchesSessionActivity(
            sessionId,
            queueTurnId,
            origin.turnId,
          )
        ) {
          return
        }
        if (queueTurnId) {
          const next = await controller.finishQueuedTurn(
            sessionId,
            queueTurnId,
            kind === 'message',
          )
          if (next) applySessionSnapshot(next)
        }
        releaseSessionActivity(
          sessionId,
          queueTurnId,
          origin.turnId,
        )
        if (kind === 'message' && shouldDrainQueue(sessionId)) {
          queueMicrotask(() => queuePumpRef.current(sessionId))
        }
      }),
    [applySessionSnapshot, controller, queuePumpRef, trackRun],
  )

  useEffect(() => {
    if (!current || status.kind !== 'idle') return
    if (!shouldDrainQueue(current.id)) return
    pumpDetached(current.id)
  }, [current, pumpDetached, status.kind])

  useEffect(
    () =>
      subscribeSessionRelease((sessionId) => {
        if (
          currentIdRef.current === sessionId &&
          shouldDrainQueue(sessionId)
        ) {
          pumpDetached(sessionId)
        }
      }),
    [currentIdRef, pumpDetached],
  )

  return {
    queueText,
    removeQueued,
    beginQueueEdit,
    commitQueueEdit,
    resumeQueue,
    settleSessionOutcome,
    editingQueueId,
    editingQueueText,
    setEditingQueueId,
    setEditingQueueText,
  }
}
