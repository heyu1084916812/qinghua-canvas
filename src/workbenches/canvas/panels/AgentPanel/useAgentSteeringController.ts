import { useCallback } from 'react'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import {
  sessionForQueuedTurn,
  type QueuedAgentTurn,
} from '../../../../domain/agent/queuedTurn'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { createId } from '../../../../shared/id'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import { errText } from '../../agent/agentLoop'
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
          /**
           * 队列项已经摘掉了：后面任何一步失败都不能直接 return ——
           * 那样这条用户消息既不回队列、也不进历史，等于静默丢失。
           *
           * 还回**输入框草稿**而不是队列：草稿是惰性的，不会被队列泵自动重发，
           * 失败原因没修好之前不会二次扣费；当前会话里还要立刻可见。
           */
          const restoreTurnText = (): boolean => {
            try {
              if (input.isCurrentSession(target.id)) {
                input.setDraft((previous) => {
                  const next = previous.trim()
                    ? `${previous}\n\n${turn.text}`
                    : turn.text
                  if (next !== previous) {
                    input.writeDraftForSession(target.id, next)
                  }
                  return next
                })
                return true
              }
              input.writeDraftForSession(target.id, turn.text)
              return true
            } catch {
              return false
            }
          }
          const reportUnsent = (label: string, detail?: unknown): void => {
            const restored = restoreTurnText()
            const suffix =
              detail === undefined ? '' : `：${errText(detail)}`
            input.notify(
              restored
                ? `${label}，这条消息已放回输入框${suffix}`
                : `${label}，且这条消息没能放回输入框，请手动重新输入${suffix}`,
              'error',
            )
          }

          let settled: Awaited<
            ReturnType<typeof input.settleInterruptedSession>
          >
          try {
            if (queuedJob?.status === 'queued') {
              await input.cancelQueuedJob(queuedJob.id)
            }
            settled = await input.settleInterruptedSession(
              withoutTurn,
              pendingConfirmation,
              'canceled',
            )
          } catch (error) {
            reportUnsent('取消等待中的动作失败', error)
            return
          }
          if (settled.cleanupError) {
            reportUnsent('取消等待中的动作失败', settled.cleanupError)
            return
          }
          const sendTarget = settled.session ?? withoutTurn
          input.notify(
            '已取消等待中的动作，并立即发送这条引导',
            'info',
          )
          try {
            const sent = await input.sendText(
              turn.text,
              sessionForQueuedTurn(sendTarget, turn),
            )
            /** `sendText` 返回 undefined = 这条消息没真正发出去。 */
            if (!sent) reportUnsent('引导发送失败')
          } catch (error) {
            reportUnsent('引导发送失败', error)
          }
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
      input.isCurrentSession,
      input.notify,
      input.promoteQueuedTurnToSteer,
      input.removeQueuedTurn,
      input.sendText,
      input.setDraft,
      input.setQueueMenuId,
      input.settleInterruptedSession,
      input.statusFor,
      input.trackRun,
      input.writeDraftForSession,
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
