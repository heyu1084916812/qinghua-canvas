/**
 * 运行引擎回调：把 planId 隔离的任务状态、批量进度和收口通知翻译成显式端口调用。
 * 不拥有 store、引擎或启动顺序；只消费宿主传入的当前项目与运行态表。
 */
import type { CanvasRunTask, RunPlan } from '../../../../features/canvas/execution/buildRunPlan'
import type { RunSummary, RunTaskState } from '../../../../features/shared/execution/runEngine'
import type { RunRecordScope } from '../../../../domain/shared/execution/runRecord'
import type { RunRequest } from '../../../../domain/canvas/nodeSpecs/types'
import type { ChannelAdapter } from '../../../../platform/channels/types'
import type { NotifyPort } from '../../../../platform/ports'
import type { NotifyKind, NotifyPrefs } from '../../../../domain/ui/notify'
import type { ExecutionPlacement } from '../../../../features/shared/execution/placement'
import type { Command } from '../../../../state/commands'
import type { TransactionBoundary } from '../../../../state/shared/types'
import type { CanvasProjectExecutionRuntime } from '../canvasExecutionRuntime'
import type {
  CanvasRecordScopeOverrideArgs,
} from '../canvasRecordScope'
import type { WorkbenchId } from '../../../../domain/shared/workbench'

export interface CanvasRunCallbacksPorts {
  runtime: CanvasProjectExecutionRuntime
  store: {
    dispatch(command: Command, transaction?: TransactionBoundary): unknown
    flush(): Promise<void>
    getSnapshot(): { projectId: string; nodes: readonly { id: string; data: unknown }[] }
    notify(text: string, tone?: 'info' | 'error'): void
  }
  workbench: WorkbenchId
  platformNotify?: NotifyPort
  recordScopeOverride?: (
    args: CanvasRecordScopeOverrideArgs,
  ) => RunRecordScope | null
  resolveCanvasRecordScope: (args: {
    workbench: WorkbenchId
    targetId: string
    planId: string
    nodeData: Readonly<Record<string, unknown>> | undefined
    override?: (
      args: CanvasRecordScopeOverrideArgs,
    ) => RunRecordScope | null
  }) => RunRecordScope
  createPlacement: (
    getProjectId: () => string,
  ) => ExecutionPlacement<CanvasRunTask, Command>
  adapterKey: (
    channelId: string,
    credentialGroupId: string | undefined,
    kind: RunRequest['kind'],
  ) => string
  updateRunStates: (
    projectId: string,
    update: (previous: Map<string, RunTaskState>) => Map<string, RunTaskState>,
  ) => void
  getNotifyPrefs: () => NotifyPrefs
  progressNotice: (done: number, total: number) => { kind: NotifyKind; text: string } | null
  runNotice: (input: { images: number; failed: number }) => {
    kind: NotifyKind
    text: string
  } | null
  shouldNotify: (prefs: NotifyPrefs, kind: 'success' | 'failure' | 'progress') => boolean
  imageCountOf: (results: RunSummary['taskResults']) => number
  sendSystemNotify: (
    notify: NotifyPort | undefined,
    title: string,
    body: string,
  ) => Promise<boolean> | boolean
}

export function createCanvasRunCallbacks(ports: CanvasRunCallbacksPorts) {
  const {
    runtime,
    store,
    workbench,
    platformNotify,
    recordScopeOverride,
    resolveCanvasRecordScope,
    createPlacement,
    adapterKey,
    updateRunStates,
    getNotifyPrefs,
    progressNotice,
    runNotice,
    shouldNotify,
    imageCountOf,
    sendSystemNotify,
  } = ports
  const planProgress = runtime.planProgress

  return {
    writeBack(commands: Command[], transaction?: TransactionBoundary): void {
      for (const command of commands) store.dispatch(command, transaction)
    },
    channelResolver(request: RunRequest, runPlanId: string): ChannelAdapter {
      const routeCandidate = request.routeCandidates?.[request.routingAttempt ?? 0]
      const ids = request.credentialGroupIds ?? []
      const groupId =
        routeCandidate?.credentialGroupId ??
        (ids.length > 0
          ? ids[Math.min(request.routingAttempt ?? 0, ids.length - 1)]
          : request.credentialGroupId)
      const channelId = routeCandidate?.channelId ?? request.channelId
      const adapter = runtime.adapterMaps
        .get(runPlanId)
        ?.get(adapterKey(channelId, groupId, request.kind))
      if (!adapter) throw new Error(`[execution] 未解析到渠道适配器：${channelId}`)
      return adapter
    },
    projectId: store.getSnapshot().projectId,
    placement: createPlacement(() => store.getSnapshot().projectId),
    recordScope(
      plan: RunPlan,
      _task: CanvasRunTask,
      targetId: string,
    ): RunRecordScope {
      const node = store.getSnapshot().nodes.find((item) => item.id === targetId)
      return resolveCanvasRecordScope({
        workbench,
        targetId,
        planId: plan.id,
        nodeData: node?.data as Readonly<Record<string, unknown>> | undefined,
        override: recordScopeOverride,
      })
    },
    onTaskUpdate(planId: string, taskId: string, state: RunTaskState): void {
      const nodeId = runtime.taskToNodeMaps.get(planId)?.get(taskId)
      if (nodeId) {
        updateRunStates(
          store.getSnapshot().projectId,
          (previous) => new Map(previous).set(nodeId, state),
        )
      }
      if (state.kind !== 'queued' && state.kind !== 'running') {
        const progress = planProgress.get(planId)
        if (progress) {
          progress.done += 1
          const notice = progressNotice(progress.done, progress.total)
          if (notice && shouldNotify(getNotifyPrefs(), notice.kind)) {
            store.notify(notice.text)
          }
        }
      }
    },
    onTaskTarget(planId: string, taskId: string, targetId: string): void {
      const mapping = runtime.taskToNodeMaps.get(planId)
      if (!mapping?.has(taskId)) return
      const from = mapping.get(taskId)!
      mapping.set(taskId, targetId)
      runtime.nodeScopedRunCancellation.addTarget(planId, targetId)
      if (from === targetId) return
      updateRunStates(store.getSnapshot().projectId, (previous) => {
        const next = new Map(previous)
        const state = next.get(from)
        next.set(targetId, state ?? { kind: 'queued' })
        next.delete(from)
        return next
      })
    },
    onFinish(summary: RunSummary): void {
      void store.flush()
      planProgress.delete(summary.runPlanId)
      if (runtime.channelInterruptedPlans.delete(summary.runPlanId)) {
        store.notify('渠道已删除，相关生成已停止；请重新选择平台后再生成', 'error')
        return
      }
      const notice = runNotice({
        images: imageCountOf(summary.taskResults),
        failed: summary.failed,
      })
      if (!notice || !shouldNotify(getNotifyPrefs(), notice.kind)) return
      store.notify(notice.text, notice.kind === 'failure' ? 'error' : 'info')
      void sendSystemNotify(platformNotify, '轻画', notice.text)
    },
  }
}
