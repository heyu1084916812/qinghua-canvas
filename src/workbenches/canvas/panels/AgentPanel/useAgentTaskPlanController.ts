import { useCallback, useEffect, useRef, useState } from 'react'
import {
  advanceAgentTaskPlanAfterReview,
} from '../../../../domain/agent/taskPlan'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import {
  IDLE_STATUS,
  type AgentPanelStatus,
} from './AgentActivityViews'

export interface AgentTaskPlanControllerInput {
  statusFor: (sessionId: string) => AgentPanelStatus
  trackRun: TaskLifecycle['track']
  abortSession: (sessionId: string) => void
  isActivityActive: (sessionId: string) => boolean
  clearRunPresentationFor: (sessionId: string) => void
  setStatusFor: (sessionId: string, status: AgentPanelStatus) => void
  updateSessionFields: (
    sessionId: string,
    patch: {
      taskPlan: AgentSession['taskPlan']
      pendingConfirmation: undefined
      continuation: undefined
      allowedToolNames: undefined
    },
  ) => Promise<AgentSession | null>
  applySessionSnapshot: (session: AgentSession) => void
  settleInterruptedSession: (
    session: AgentSession,
    request: AgentToolRequest | undefined,
    result: 'canceled' | 'interrupted',
  ) => Promise<{ cleanupError?: unknown }>
  sendText: (
    text: string,
    session: AgentSession,
    options: { internalControl: true },
  ) => Promise<unknown>
  notify: (message: string, tone?: 'info' | 'error') => void
  sleep?: (milliseconds: number) => Promise<void>
  /**
   * 目标是否仍是面板正在显示的会话。
   *
   * 推进是**用户点的那一下**，但「取消旧确认 → 等旧回合收尾」全是异步的；这期间用户
   * 完全可能切到别的会话。切走之后不许再落计划、更不许再发那条**隐藏控制消息**
   * —— 那会替用户开一次没人看着的付费回合。所以在提交点前复检一次。
   *
   * 与 `useAgentContinuationController` 的 `isCurrentSession` 同形态；
   * 不传视为「目标就是当前会话」（老调用与单测的默认口径）。
   */
  isCurrentSession?: (sessionId: string) => boolean
}

export interface AgentTaskPlanController {
  advanceTaskPlan: (session: AgentSession) => Promise<boolean>
  isAdvancingTaskPlan: (sessionId: string) => boolean
}

export function useAgentTaskPlanController(
  input: AgentTaskPlanControllerInput,
): AgentTaskPlanController {
  const [advancingIds, setAdvancingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const inFlightRef = useRef(new Map<string, Promise<boolean>>())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const markAdvancing = useCallback(
    (sessionId: string, advancing: boolean) => {
      if (!mountedRef.current) return
      setAdvancingIds((previous) => {
        const already = previous.has(sessionId)
        if (already === advancing) return previous
        const next = new Set(previous)
        if (advancing) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
    },
    [],
  )

  const advanceTaskPlan = useCallback(
    (target: AgentSession): Promise<boolean> => {
      const existing = inFlightRef.current.get(target.id)
      if (existing) return existing

      markAdvancing(target.id, true)
      let work: Promise<boolean>
      try {
        work = input.trackRun(async () => {
          if (!target.taskPlan) {
            input.notify('当前没有可推进的任务计划', 'info')
            return false
          }
          const currentStep = target.taskPlan.steps.find(
            (step) => step.id === target.taskPlan?.currentStepId,
          )
          const advanced = advanceAgentTaskPlanAfterReview(
            target.taskPlan,
            currentStep?.id,
            Date.now(),
          )
          if (!advanced.ok) {
            input.notify(advanced.problems.join('；'), 'error')
            return false
          }

          const targetStatus = input.statusFor(target.id)
          const pendingConfirmation =
            targetStatus.kind === 'awaitingConfirm'
              ? targetStatus.request
              : target.pendingConfirmation
          input.abortSession(target.id)
          if (pendingConfirmation) {
            const settled = await input.settleInterruptedSession(
              target,
              pendingConfirmation,
              'canceled',
            )
            if (settled.cleanupError) return false
          } else {
            const sleep =
              input.sleep ??
              ((milliseconds: number) =>
                new Promise<void>((resolve) => {
                  setTimeout(resolve, milliseconds)
                }))
            for (let attempt = 0; attempt < 60; attempt += 1) {
              if (!mountedRef.current) return false
              if (!input.isActivityActive(target.id)) break
              await sleep(100)
            }
          }
          if (!mountedRef.current) return false
          if (input.isActivityActive(target.id)) {
            input.notify('旧验收仍在收尾，请稍后再点一次', 'error')
            return false
          }

          /**
           * 提交点复检：上面每条 await 期间用户都可能已经切走。
           * 切走了就整单退出 —— 不落计划、不发隐藏控制消息，advancing 由 finally 清掉。
           */
          const stillCurrent = input.isCurrentSession
            ? input.isCurrentSession(target.id)
            : true
          if (!stillCurrent) return false

          const updated = await input.updateSessionFields(target.id, {
            taskPlan: advanced.plan,
            pendingConfirmation: undefined,
            continuation: undefined,
            allowedToolNames: undefined,
          })
          if (!updated || !mountedRef.current) return false

          input.applySessionSnapshot(updated)
          input.clearRunPresentationFor(target.id)
          input.setStatusFor(target.id, IDLE_STATUS)

          const closed = currentStep?.title ?? '当前步骤'
          const next = advanced.plan.steps.find(
            (step) => step.id === advanced.plan.currentStepId,
          )
          if (!next) {
            input.notify(`已完成「${closed}」，整个计划已结束`, 'info')
            return true
          }
          input.notify(
            `已跳过「${closed}」验收，进入「${next.title}」`,
            'info',
          )
          await input.sendText(
            `系统控制：用户已跳过「${closed}」的验收并确认直接进入下一步。` +
              `现在开始执行计划步骤「${next.title}」。` +
              `请沿用计划目标、已有画布产物和约束继续，不要再次询问是否进入下一步，` +
              `也不要把这句控制指令当成新的业务需求。`,
            updated,
            { internalControl: true },
          )
          return true
        })
      } catch (error) {
        inFlightRef.current.delete(target.id)
        markAdvancing(target.id, false)
        return Promise.reject(error)
      }
      const shared = work.finally(() => {
        inFlightRef.current.delete(target.id)
        markAdvancing(target.id, false)
      })
      inFlightRef.current.set(target.id, shared)
      return shared
    },
    [
      input.abortSession,
      input.applySessionSnapshot,
      input.clearRunPresentationFor,
      input.isActivityActive,
      input.isCurrentSession,
      input.notify,
      input.sendText,
      input.settleInterruptedSession,
      input.sleep,
      input.statusFor,
      input.trackRun,
      input.updateSessionFields,
      input.setStatusFor,
      markAdvancing,
    ],
  )

  const isAdvancingTaskPlan = useCallback(
    (sessionId: string) => advancingIds.has(sessionId),
    [advancingIds],
  )

  return { advanceTaskPlan, isAdvancingTaskPlan }
}
