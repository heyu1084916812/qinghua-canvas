import { useCallback } from 'react'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import {
  sessionForQueuedTurn,
  type QueuedAgentTurn,
} from '../../../../domain/agent/queuedTurn'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { createId } from '../../../../shared/id'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import {
  statusCanSteer,
  type AgentPanelStatus,
} from './AgentActivityViews'

export interface AgentSteeringControllerInput {
  current: AgentSession | null
  statusFor: (sessionId: string) => AgentPanelStatus
  isCurrentSession: (sessionId: string) => boolean
  trackRun: TaskLifecycle['track']
  queueText: (text: string) => Promise<boolean>
  sendText: (
    text: string,
    session: AgentSession,
  ) => Promise<unknown>
  settleInterruptedSession: (
    session: AgentSession,
    request: AgentToolRequest | undefined,
    result: 'canceled' | 'interrupted',
  ) => Promise<{
    cleanupError?: unknown
    session?: AgentSession | null
  }>
  removeQueuedTurn: (
    sessionId: string,
    turnId: string,
  ) => Promise<AgentSession | null>
  promoteQueuedTurnToSteer: (
    sessionId: string,
    turnId: string,
    steerId: string,
  ) => Promise<
    | { ok: true; session: AgentSession }
    | {
        ok: false
        reason:
          | 'missing'
          | 'has_assets'
          | 'steer_full'
          | 'awaiting_confirmation'
      }
  >
  enqueueSteer: (
    sessionId: string,
    steer: { id: string; text: string; createdAt: number },
  ) => Promise<
    | { ok: true; session: AgentSession }
    | { ok: false; reason: 'empty' | 'full' | 'missing' }
  >
  getQueuedJob: (
    sessionId: string,
    turnId: string,
  ) => Promise<{ id: string; status: string } | null>
  cancelQueuedJob: (jobId: string) => Promise<void>
  applySessionSnapshot: (session: AgentSession) => void
  setDraft: (
    update: string | ((previous: string) => string),
  ) => void
  writeDraftForSession: (sessionId: string, text: string) => void
  setQueueMenuId: (turnId: string | null) => void
  notify: (message: string, tone?: 'info' | 'error') => void
}

export interface AgentSteeringController {
  guideQueuedTurn: (turn: QueuedAgentTurn) => Promise<void>
  guideDraft: (raw: string) => Promise<boolean>
}

export function useAgentSteeringController(
  input: AgentSteeringControllerInput,
): AgentSteeringController {
  const guideQueuedTurn = useCallback(
    (turn: QueuedAgentTurn) =>
      input.trackRun(async () => {
        const target = input.current
        if (!target) return
        const targetStatus = input.statusFor(target.id)
        if (!statusCanSteer(targetStatus)) return
        if (turn.pendingAssetIds?.length) {
          input.notify(
            '带新素材的消息不能中途引导，请等它按队列发送',
            'error',
          )
          return
        }
        const queuedJob = await input.getQueuedJob(target.id, turn.id)
        const pendingConfirmation =
          targetStatus.kind === 'awaitingConfirm'
            ? targetStatus.request
            : target.pendingConfirmation

        if (pendingConfirmation) {
          const withoutTurn = await input.removeQueuedTurn(
            target.id,
            turn.id,
          )
          if (!withoutTurn) return
          input.applySessionSnapshot(withoutTurn)
          if (queuedJob?.status === 'queued') {
            await input.cancelQueuedJob(queuedJob.id)
          }
          const settled = await input.settleInterruptedSession(
            withoutTurn,
            pendingConfirmation,
            'canceled',
          )
          if (settled.cleanupError) return
          const sendTarget = settled.session ?? withoutTurn
          input.notify(
            '已取消等待中的动作，并立即发送这条引导',
            'info',
          )
          await input.sendText(
            turn.text,
            sessionForQueuedTurn(sendTarget, turn),
          )
          return
        }

        const promoted = await input.promoteQueuedTurnToSteer(
          target.id,
          turn.id,
          createId('steer'),
        )
        if (!promoted.ok) {
          input.notify(
            promoted.reason === 'has_assets'
              ? '带新素材的消息不能中途引导，请等它按队列发送'
              : promoted.reason === 'steer_full'
                ? '当前任务的引导已达上限'
                : promoted.reason === 'awaiting_confirmation'
                  ? 'Agent 正在等待确认，请重新点击引导'
                  : '这条排队消息已经不存在',
            'error',
          )
          return
        }
        input.applySessionSnapshot(promoted.session)
        if (queuedJob?.status === 'queued') {
          await input.cancelQueuedJob(queuedJob.id)
        }
        input.setQueueMenuId(null)
        input.notify(
          '已转为引导，将在 Agent 下一次动作前应用',
          'info',
        )
      }),
    [
      input.applySessionSnapshot,
      input.cancelQueuedJob,
      input.current,
      input.getQueuedJob,
      input.notify,
      input.promoteQueuedTurnToSteer,
      input.removeQueuedTurn,
      input.sendText,
      input.setQueueMenuId,
      input.settleInterruptedSession,
      input.statusFor,
      input.trackRun,
    ],
  )

  const guideDraft = useCallback(
    (raw: string) =>
      input.trackRun(async () => {
        const text = raw.trim()
        const target = input.current
        if (!text || !target) return false
        if (target.pendingAssetIds?.length) {
          input.notify(
            '带新素材的消息不能中途引导，已改为排队发送',
            'info',
          )
          return input.queueText(text)
        }
        const targetStatus = input.statusFor(target.id)
        const pendingConfirmation =
          targetStatus.kind === 'awaitingConfirm'
            ? targetStatus.request
            : target.pendingConfirmation
        if (pendingConfirmation) {
          const settled = await input.settleInterruptedSession(
            target,
            pendingConfirmation,
            'canceled',
          )
          if (settled.cleanupError) return false
          const sendTarget = settled.session ?? target
          input.notify(
            '已取消等待中的动作，并立即发送这条引导',
            'info',
          )
          await input.sendText(text, sendTarget)
          return true
        }

        const steered = await input.enqueueSteer(target.id, {
          id: createId('steer'),
          text,
          createdAt: Date.now(),
        })
        if (!steered.ok) {
          input.notify(
            steered.reason === 'full'
              ? '当前任务的引导已达上限'
              : '引导发送失败，请稍后重试',
            'error',
          )
          return false
        }
        input.applySessionSnapshot(steered.session)
        if (input.isCurrentSession(target.id)) {
          input.setDraft((value) => {
            const next = value.trim() === text ? '' : value
            if (next !== value) {
              input.writeDraftForSession(target.id, next)
            }
            return next
          })
        }
        input.notify(
          '已作为引导发送，将在 Agent 下一次动作前应用',
          'info',
        )
        return true
      }),
    [
      input.applySessionSnapshot,
      input.current,
      input.enqueueSteer,
      input.isCurrentSession,
      input.notify,
      input.queueText,
      input.sendText,
      input.setDraft,
      input.settleInterruptedSession,
      input.statusFor,
      input.trackRun,
      input.writeDraftForSession,
    ],
  )

  return { guideQueuedTurn, guideDraft }
}
