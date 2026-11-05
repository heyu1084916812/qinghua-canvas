import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createGenerationClient } from '../../../platform/generation'
import { buildRunPlan, type CanvasRunTask } from '../../../features/canvas/execution/buildRunPlan'
import { createId } from '../../../shared/id'
import { emptyPlanReason } from '../../../features/canvas/execution/emptyPlanReason'
import {
  candidateDownstream,
  hasRunnableDownstream,
} from '../../../features/canvas/execution/loopRun'
import type {
  LoopData,
  GenerationContextAsset,
  NodeSnapshot,
} from '../../../domain/canvas/model/node'
import { createCanvasPlacement } from '../../../features/canvas/execution/canvasPlacement'
import { fuseNode } from '../../../features/canvas/execution/fuseNode'
// 执行引擎与宿主上移共享层（M6-5 路径 B）：画布注入自己的命令类型与落位适配器
import { useExecution } from '../../../features/shared/execution/useExecution'
import { trimProjectTasks } from '../../../features/shared/execution/taskLog'
import { bindAbortToCancel } from '../../../features/shared/execution/abortToCancel'
import type { RunTaskState } from '../../../features/shared/execution/runEngine'
import type { ExecutionRuntime } from '../../../features/shared/execution/executionRuntime'
import {
  registerGuardedChannelRun,
  unregisterGuardedChannelRun,
} from '../../../state/shared/runChannelGuard'
import { imageCountOf, progressNotice, runNotice, shouldNotify } from '../../../domain/ui/notify'
import { getNotifyPrefs } from '../../../state/ui/notifyPrefs'
import { sendSystemNotify } from '../../../features/shared/notify/desktopNotify'
import type { Command } from '../../../state/commands'
import { createChannelRepository } from '../../../state/project/channelRepository'
import type { RunRecordScope } from '../../../domain/shared/execution/runRecord'
import type { WorkbenchId } from '../../../domain/shared/workbench'
import {
  resolveCanvasRecordScope,
  type CanvasRecordScopeOverrideArgs,
} from './canvasRecordScope'
import type { RunRecord } from '../../../domain/canvas/model/runRecord'
import type { FusionData } from '../../../domain/canvas/model/node'
import { useCanvasStore } from '../storeContext'
import { RunHotkeys } from './RunHotkeys'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { useSkillsOptional } from '../../../app/providers/SkillStoreProvider'
import { usePresetTextOptional } from '../../../app/providers/PresetTextProvider'
import type { PromptData } from '../../../domain/canvas/model/node'
import { buildGroupRunPlan } from '../../../features/canvas/execution/groupRunPlan'
import {
  canvasRunIsRunning,
  canvasRunStatesOf,
  subscribeCanvasRunStates,
  updateCanvasRunStates,
} from './canvasRunState'
import {
  activateCanvasExecutionRuntime,
  peekCanvasExecutionRuntime,
} from './canvasExecutionRuntime'
import {
  adapterKey,
  canceledRun,
  CanvasRunPreflightError,
  prepareCanvasRun,
  type CanvasRunLaunchResult,
  type CanvasRunPreflightFailure,
} from './canvasRunPreflight'
import { useCanvasRunRecorder } from './useCanvasRunRecorder'
import { createCanvasRunCallbacks } from './provider/runCallbacks'
import { completeCanvasText, type CanvasTextRequest } from './provider/textExecution'
import {
  applyComposeFromDraft,
  applySelectedSkill,
} from './provider/promptPreparation'
import { runCanvasLoop } from './provider/loopRunPlan'

export {
  CanvasRunPreflightError,
  type CanvasRunPreflightFailure,
} from './canvasRunPreflight'

/**
 * 画布执行宿主（架构 §4.7 / §5.5）：把 `useExecution` 接到画布 store + 渠道解析器。
 * 节点视图只 emit `requestRun`，由这里翻译成 buildRunPlan + runEngine 调用；
 * 运行进度按 nodeId 反查后暴露给节点视图渲染（running / error / runMode）。
 *
 * 本层还持有两样**界面零认知的执行派生状态**：
 * - 各节点的成功指纹基线 → 对账出陈旧标记（§6.19.5）；
 * - 全图重跑的二次确认（§6.19.1）——顶栏按钮与快捷键都要经过它，放在这里避免各写一套。
 */
export interface CanvasExecutionApi {
  /** 单点生成（R / 面板 / 右键「生成」）；alt = `Alt+R`（保留旧内容，拓扑方向铺新下游） */
  /**
   * 跑一个节点。
   *
   * - `alt`：**再抽一张** —— 保留原有节点，另铺一个承载节点（画布上的 ⇧/Alt 生成）。
   * - `inPlace`：**原地替换** —— 产物写回源节点自己（电商结果的「原地换掉」，对账 #413）。
   *   只在这条计划一共一次调用时生效（N>1 会互相覆盖，见 `buildRunPlan` 的说明）。
   */
  runNode(
    nodeId: string,
    opts?: {
      alt?: boolean
      inPlace?: boolean
      signal?: AbortSignal
      contextAssets?: readonly GenerationContextAsset[]
    },
  ): Promise<void>
  /** 把一个分组的成员作为一个子图规划并运行；不会逐节点绕过上游依赖。 */
  runGroup(memberIds: readonly string[]): Promise<void>
  /** Cancel only the active plan(s) attached to this node. */
  cancel(nodeId: string): void
  nodeStateOf(nodeId: string): RunTaskState | undefined
  /**
   * 全部节点状态（按项目维度）。
   *
   * 给自己人**按状态对账**用：执行失败是**记在状态里**的，不一定抛异常 ——
   * 只看 `try/catch` 会把「图没出成」报成成功，用户拿不到任何原因
   * （用户 2026-10-06 第七批 #188：「有图片失败了没有给我报错原因」）。
   */
  nodeStates: ReadonlyMap<string, RunTaskState>
  isRunning: boolean
  /** 追加 RunRecord（runEngine 之外的写入方，如版本恢复）并同步版本计数（§6.21） */
  appendRecord(record: RunRecord): Promise<void>
  /**
   * 文本 LLM 单次调用（提示词节点「优化 / 翻译 / 反推」，§6.7）。从渠道解析适配器并调 completeText
   *
   * `inputs` 是可带可不带：优化 / 翻译只处理文本，反推必须带上游图片素材——
   * 图若进不了这个请求，「上游图片送进 LLM」就永远只是界面上画了条线而已。
   */
  completeText(req: CanvasTextRequest): Promise<string>
}

function throwPreflightForCaller(
  result: CanvasRunLaunchResult,
  signal?: AbortSignal,
): void {
  if (!result.ok && !result.canceled && signal) {
    throw new CanvasRunPreflightError(result.failures)
  }
}

function linkRunSignal(
  engine: ExecutionRuntime,
  parent?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const registrationId = createId('run-signal')
  const abort = () => controller.abort(parent?.reason)
  const subscribed = !parent?.aborted && !engine.closing
  if (subscribed) parent?.addEventListener('abort', abort, { once: true })
  else abort()
  engine.controllers.add(registrationId, controller)
  return {
    signal: controller.signal,
    dispose() {
      parent?.removeEventListener('abort', abort)
      engine.controllers.remove(registrationId)
    },
  }
}

const Ctx = createContext<CanvasExecutionApi | null>(null)

/**
 * 常驻宿主使用的稳定 API 视图。
 *
 * 方法闭包捕获自仍然存活的 provider 实例；运行态读取则每次访问项目级 live store，
 * 所以 CanvasExecutionProvider 随路由卸载后，nodeStates / isRunning 仍会更新。
 */
export function createCanvasExecutionHostAdapter(
  projectId: string,
  api: CanvasExecutionApi,
): CanvasExecutionApi {
  return {
    runNode: api.runNode,
    runGroup: api.runGroup,
    cancel: api.cancel,
    appendRecord: api.appendRecord,
    completeText: api.completeText,
    get nodeStates() {
      return canvasRunStatesOf(projectId)
    },
    nodeStateOf(nodeId) {
      return canvasRunStatesOf(projectId).get(nodeId)
    },
    get isRunning() {
      return (
        peekCanvasExecutionRuntime(projectId)?.engine.isRunning() ||
        canvasRunIsRunning(projectId)
      )
    },
  }
}

/** 只注入既有 API 值，不创建第二套执行引擎。 */
export function CanvasExecutionValueProvider({
  value,
  children,
}: {
  value: CanvasExecutionApi
  children: ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * 「正在跑」状态按**项目**存，不按组件实例存。
 *
 * 用户 2026-10-06 报的 bug：「替换不同的项目的时候，之前正在进行中的生成节点的生成状态会消失，
 * 不知道是否停止了还是怎么回事」。
 *
 * 根因有两层，缺一层都解释不完整：
 *  ① `CanvasProject` 用 `key={projectId}` 挂载 ⇒ 切项目 = 整棵画布子树**卸载重挂**，
 *     而这份状态原是组件 `useState` —— 一卸载就没了；
 *  ② **运行并没有停**：引擎拿着旧 store 的引用继续跑完、把结果写进同一个项目，
 *     只是界面上既不显示「在跑」，抬头也看不到结果（新挂载的页面是另一个 store 实例）。
 * 于是用户完全无从判断：到底是停了、还是在跑、还是跑完了没保存。
 *
 * 把状态提到模块级、**按 projectId 分桶**之后：切走再回来，转圈还在；
 * 旧实例里的回调照常更新它（闭包里那个 projectId 是同一个），新挂载的 provider 订阅收到。
 * 配套的另一半在 `CanvasPage`：画布 store 也按项目缓存，否则结果仍会写进一个没人看的实例。
 */
export function CanvasExecutionProvider({
  children,
  workbench = 'canvas',
  recordScopeOverride,
}: {
  children: ReactNode
  workbench?: WorkbenchId
  recordScopeOverride?: (
    args: CanvasRecordScopeOverrideArgs,
  ) => RunRecordScope | null
}) {
  const store = useCanvasStore()
  const channels = useChannels()
  const platform = usePlatform()
  /**
   * 用**可选**版本：技能是增强项，没选技能时执行层完全不碰它。
   * 若用会抛错的 `useSkills`，任何没挂 SkillStoreProvider 的渲染路径
   * （部分单测、以及将来可能的新入口）都会当场崩 —— 那是整屏黑屏，
   * 代价远大于「技能列表为空」。
   */
  const skillStore = useSkillsOptional()
  /** 功能预设词：有图时「点生成」沿用后台改过的「反推」指令 */
  const presetText = usePresetTextOptional()
  const repo = useMemo(
    () => createChannelRepository(platform.storage, platform.credentials),
    [platform.storage, platform.credentials],
  )
  const generation = useMemo(
    () =>
      createGenerationClient({
        platform,
        catalog: () => channels.protocolCatalog(),
        loadToken: (credentialRef) => repo.credentials.load(credentialRef),
      }),
    [channels, platform, repo],
  )
  const projectId = store.getSnapshot().projectId
  const runtime = useMemo(
    () => activateCanvasExecutionRuntime(projectId),
    [projectId],
  )

  /**
   * 并发运行各自的适配器表：planId → (channelId → adapter)。
   *
   * 不能只存一份全局 map —— 第二条链路启动时会覆盖第一条的解析结果，
   * 第一条的 `channelResolver` 就会拿到错渠道或直接抛「未解析到渠道适配器」。
   */
  /**
   * 提示词节点「生成正文」阶段的并发闸门。
   *
   * 技能 / 草稿 → LLM 发生在引擎启动**之前**，此时 `isRunning` 仍是 false；
   * 不在这里挡住，用户连点两次会发两次请求（= 两次扣费），而且后一次的结果
   * 可能覆盖前一次。同时把节点标成 running，让等待期间有可见反馈。
   */
  const preparingPrompt = runtime.preparingPrompt
  /**
   * 「正在跑」状态从**按项目**的 `canvasRunState` 读。
   *
   * 用 `useSyncExternalStore` 而不是 `useState`：切走再回来时，负责这次运行的是**旧实例**
   * 里的回调 —— 它只会更新模块级那份，新挂载的 provider 必须能收到，否则转圈照样不显示。
   */
  const nodeStates = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeCanvasRunStates(projectId, listener), [projectId]),
    () => canvasRunStatesOf(projectId),
    () => canvasRunStatesOf(projectId),
  )

  /**
   * 当前所有活动计划已经占用的“运行席位”。
   *
   * `runStates` 只回答 UI 可见状态；任务在渠道解析阶段时目标节点还没写进去。
   * `runtime.taskToNodeMaps` 会在落点确定后立刻把真实承载节点补进来。两者取并集，
   * 才能阻止连续点击把同一个空节点当成两个计划的共同落点。
   */
  const activeRunNodeIds = useCallback((): ReadonlySet<string> => {
    const ids = new Set<string>()
    for (const [nodeId, state] of canvasRunStatesOf(projectId)) {
      if (state.kind === 'queued' || state.kind === 'running') ids.add(nodeId)
    }
    for (const taskToNode of runtime.taskToNodeMaps.values()) {
      for (const nodeId of taskToNode.values()) ids.add(nodeId)
    }
    return ids
  }, [projectId, runtime])

  /**
   * 版本账本与引擎外记录追加由 run recorder 独占。
   * 正常 runEngine 的记录构造、recordScope 和操作生命周期仍留在本 Provider。
   */
  const {
    nextVersion: bumpVersion,
    appendRecord,
    appendFusionRecord,
  } = useCanvasRunRecorder({
    projectId,
    runtime,
    store,
    storage: platform.storage,
  })

  /**
   * 批量进度计数（对账 #386 的 E5），按 planId 分开记。
   *
   * 只对"一次跑多个任务"的计划说话（`domain/ui/notify.progressNotice` 判的），
   * 而且**最后一个任务不再报进度** —— 收口那一句由 `onFinish` 的完成 / 失败通知说，
   * 两条挨着弹只会让提示位把前一条盖掉。
   */
  const planProgress = runtime.planProgress

  const host = useMemo(
    () => ({
      ...createCanvasRunCallbacks({
        runtime,
        store,
        workbench,
        platformNotify: platform.notify,
        recordScopeOverride,
        resolveCanvasRecordScope,
        createPlacement: createCanvasPlacement,
        adapterKey,
        updateRunStates: updateCanvasRunStates,
        getNotifyPrefs,
        progressNotice,
        runNotice,
        shouldNotify,
        imageCountOf,
        sendSystemNotify,
      }),
      // 引擎为每个 task 各调一次（写回发生在两次调用之间），同步递增即得连续版本号
      nextVersion: bumpVersion,
    }),
    [bumpVersion, platform.notify, recordScopeOverride, runtime, store, workbench],
  )

  const { startRun, cancelRun, isRunning } = useExecution<CanvasRunTask, Command>(
    host,
    runtime.engine,
  )

  const failPlan = useCallback(
    (
      plan: ReturnType<typeof buildRunPlan>,
      failures: readonly CanvasRunPreflightFailure[],
    ): CanvasRunLaunchResult => {
      const failureByTask = new Map(
        failures.map((failure) => [failure.taskId, failure] as const),
      )
      const allFailures: CanvasRunPreflightFailure[] = plan.tasks.map((task) => {
        const current = failureByTask.get(task.id)
        if (current) return current
        return {
          taskId: task.id,
          nodeId: task.nodeId,
          error: {
            kind: 'validation',
            field: 'runPlan',
            reason: '同批任务预检失败，整批未启动',
          },
          message: '同批任务预检失败，整批未启动',
        }
      })
      const errorByNode = new Map<
        string,
        CanvasRunPreflightFailure['error']
      >()
      for (const failure of allFailures) {
        if (!errorByNode.has(failure.nodeId) || failureByTask.has(failure.taskId)) {
          errorByNode.set(failure.nodeId, failure.error)
        }
      }
      updateCanvasRunStates(store.getSnapshot().projectId, (previous) => {
        const states = new Map(previous)
        for (const [nodeId, error] of errorByNode) {
          states.set(nodeId, { kind: 'failed', error, attempts: 1 })
        }
        return states
      })
      const first = failures[0]
      if (first) {
        store.notify(
          failures.length > 1
            ? `${first.message}；同批共 ${failures.length} 个任务预检失败`
            : first.message,
          'error',
        )
      }
      return { ok: false, canceled: false, failures: allFailures }
    },
    [store],
  )

  /** 渠道预解析 + 状态注入 + 派发执行计划 + 启动运行 */
  const launch = useCallback(
    async (
      plan: ReturnType<typeof buildRunPlan>,
      originNodeId: string | undefined,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) return canceledRun()
      /**
       * M7-3：执行前**按策略选路**并解析模型映射（§7.4.1）。
       *
       * 时机：在适配器预解析之前。因为「选哪条渠道」决定要解析哪条渠道的
       * 适配器与令牌 —— 先选路、再解析，顺序反了就会拿错渠道的凭据。
       *
       * 两条不变式（架构 §6.3）：
       *  ① 选中后 `request.model` 变成**该渠道的上游 ID**；适配器不需要认识逻辑名。
       *  ② 没有任何渠道提供这个逻辑模型 → **如实报错**，不静默退回原名
       *    （那会拿一个可能已下线的名字去请求，失败原因极难定位）。
       */
      const preflight = await prepareCanvasRun({
        plan,
        signal,
        channels: () => channels.getState().channels,
        currentChannels: () => channels.getState().channels,
        routeStrategy: () => channels.getState().routeStrategy,
        hasLocalCli: platform.cli != null,
        loadCredential: (credentialRef) => repo.credentials.load(credentialRef),
        planGenerationRoute: (opts) => channels.planGenerationRoute(opts),
        resolveAdapter: async ({
          channel,
          model,
          kind,
          credentialGroupId,
        }) => {
          const target = await generation.resolve({
            channel,
            request: { model },
            kind,
            hints: {
              modelIsUpstream: true,
              ...(credentialGroupId ? { credentialGroupId } : {}),
            },
          })
          return target.adapter
        },
        random: Math.random(),
      })
      if (!preflight.ok) {
        return preflight.canceled
          ? preflight
          : failPlan(plan, preflight.failures)
      }
      const map = preflight.adapters
      runtime.adapterMaps.set(plan.id, map)
      const taskToNode = new Map(
        plan.tasks.map((task) => [task.id, task.nodeId] as const),
      )
      const taskChannels = preflight.taskChannels
      runtime.taskToNodeMaps.set(plan.id, taskToNode)
      runtime.nodeScopedRunCancellation.trackPlan(plan.id, [
        ...(originNodeId ? [originNodeId] : []),
        ...plan.tasks.map((task) => task.nodeId),
      ])
      const projectId = store.getSnapshot().projectId
      registerGuardedChannelRun(plan.id, {
        taskChannels,
        cancel: () => cancelRun(plan.id),
        onInterrupted: (affected) => {
          runtime.channelInterruptedPlans.add(plan.id)
          updateCanvasRunStates(projectId, (prev) => {
            const states = new Map(prev)
            for (const { taskId } of affected) {
              const nodeId = taskToNode.get(taskId)
              if (!nodeId) continue
              states.set(nodeId, {
                kind: 'failed',
                error: { kind: 'channel', detail: 'missingChannel' },
                attempts: 1,
              })
            }
            return states
          })
          store.notify('渠道已删除，相关生成已停止；请重新选择平台后再生成', 'error')
        },
      })
      /**
       * 启动时的 `queued`：只给**落点可能仍是自己**的任务。
       *
       * 此前无条件按 `plan.tasks` 的 nodeId（全是**源节点**）置 queued：
       * 源节点已有素材时会另建承载节点，而「另建」这个决定要等引擎真正跑起来
       * （`placement.begin`）才知道——中间隔着渠道解析、令牌读取这些 await。
       * 于是源节点（已经有图、这次只是被当参考图用）会先转一圈，
       * 随后状态才被搬到新节点上，用户看到「我没让它生成，它在生成」（2026-09-17 实测，
       * MutationObserver 抓到源节点约 14ms 的 `running`，慢渠道下这个窗口会更长）。
       *
       * 计划期就能判定落点的两种情形，先画在这两个节点上：
       *  - `slot.kind === 'reuse'` 且不是批量展开的后续调用 → 落点就是它自己；
       *  - 其余（要另建承载的）由 `onTaskTarget` 在落点确定后补上（见下）。
       * 这样源节点再也不会平白进入生成态。
       */
      try {
      updateCanvasRunStates(store.getSnapshot().projectId, (prev) => {
        const n = new Map(prev)
        for (const t of plan.tasks) {
          if (t.slot.kind === 'reuse' && (t.seq ?? 0) === 0) n.set(t.nodeId, { kind: 'queued' })
        }
        return n
      })

      // 落 tasks 表（执行计划图数据化形态，供日志与中断恢复）
      store.dispatch({
        kind: 'runPlan.execute',
        planId: plan.id,
        scope: plan.scope,
        mode: plan.mode,
        originNodeId,
      })
      /**
       * 顺手把 `tasks` 表按项目裁到最近 500 条（产品文档 §6.18「超出滚动裁剪」，对账 #460）。
       *
       * 位置选在这里：**每次落一行计划就做一次**（一行一次的读 + 必要时删）。
       * 口径三条：**不 await**（日志表的维护绝不该挡住出图）、**失败只记日志**、
       * 没到上限时一次都不删（`trimProjectTasks` 内部直接返回 0）。
       */
      void trimProjectTasks(platform.storage, store.getSnapshot().projectId).catch((err) => {
        platform.logger.log('warn', '[tasks] 滚动裁剪未完成', { error: String(err) })
      })

      // 批量进度的分母：这条计划有几个任务（单任务时 progressNotice 会自己闭嘴）
      planProgress.set(plan.id, { done: 0, total: plan.tasks.length })

      const unbindAbort = bindAbortToCancel(signal, () => cancelRun(plan.id))
      try {
        await startRun(plan)
        /**
         * `runEngine` 结束后，节点结果与 RunRecord 仍可能留在 store 的防抖队列里。
         * `runNode()` 的 Promise 只有在这里等到 flush 完成，调用方读 `runRecords`
         * 才不会把一张已经成功的图误判成“没有留下记录”。
         */
        await store.flush()
      } finally {
        unbindAbort()
      }

      /**
       * 配方记忆**不再挂在这里**（用户 2026-09-23 修订口径）。
       *
       * 原口径「生成成功那一刻才记」已被用户否掉：他要的是「只要我改了参数就记住」。
       * 现在的记录点在 `PanelLayer` 的参数变更事件里（含新建节点时写入默认值那一档），
       * 与生成成功与否无关——改了就算数。
       *
       * 留这段注释而不是直接删掉，是因为「生成成功才记」看上去很合理、
       * 下次很容易被当成修复对象加回来；这里说明它是**有意去掉的**。
       */

      updateCanvasRunStates(store.getSnapshot().projectId, (prev) => {
        const n = new Map(prev)
        /**
         * 清理本计划挂在节点上的状态。
         *
         * 必须按「实际落点」清理：落位若另建了承载节点，`onTaskTarget` 已把状态
         * 从源节点搬到新节点 —— 这里若仍按 `plan.tasks` 的 nodeId（全是源节点）
         * 清理，新节点上的 queued/running 会永远留在那里，
         * 表现为「图已经出来了、转圈还在转」（2026-09-16 截图反馈）。
         *
         * 故按本计划**触达过的全部节点**（源节点 + 承载节点）清理；
         * 并发跑同一节点时，别的 plan 仍占用的节点不能抹。
         */
        const touched = [...(runtime.taskToNodeMaps.get(plan.id)?.values() ?? [])]
        const stillRunning = new Set(
          [...runtime.taskToNodeMaps.entries()]
            .filter(([id]) => id !== plan.id)
            .flatMap(([, m]) => [...m.values()]),
        )
        for (const nid of touched) if (!stillRunning.has(nid)) n.delete(nid)
        return n
      })
      } finally {
        unregisterGuardedChannelRun(plan.id)
        runtime.nodeScopedRunCancellation.release(plan.id)
        runtime.adapterMaps.delete(plan.id)
        runtime.taskToNodeMaps.delete(plan.id)
      }
      return { ok: true } as const
    },
    [store, channels, repo, platform, generation, startRun, cancelRun, failPlan],
  )

  /**
   * 「计划为空」时给出可见反馈。
   *
   * 用户 2026-09-23 报「点生成没有反应」：节点若缺 channelId / model，规格的
   * `toRunRequest` 返回 null ⇒ 该节点不进计划 ⇒ `runNode` 见到 `tasks.length === 0`
   * 直接 return。全程没有 toast、没有日志、没有状态变化，用户只能得出「按钮坏了」。
   *
   * 面板侧已经把关（缺渠道 / 缺模型时按钮置灰并写明原因），这里是**第二道**：
   * 入口不止面板一个（快捷键 R、右键菜单、节点自身按钮），任何一条走到这里都要说话。
   *
   * 文案按节点当前状态分叉，而不是给一句笼统的「无法生成」——用户需要知道去改什么。
   */
  const explainEmptyPlan = useCallback(
    (nodeId: string) => {
      const graph = store.getSnapshot()
      const node = graph.nodes.find((n) => n.id === nodeId)
      const reason = emptyPlanReason(node, channels.getState().channels, graph)
      if (!reason) return
      store.notify(`${reason}，无法生成`, 'error')
    },
    [store, channels],
  )

  const completeText = useCallback(
    (request: CanvasTextRequest): Promise<string> => {
      const linked = linkRunSignal(runtime.engine, request.signal)
      return runtime.operations.track(() => completeCanvasText(request, {
        channels: () => channels.getState().channels,
        generation,
        storage: platform.storage,
        projectId: () => store.getSnapshot().projectId,
        workbench,
        notify: store.notify,
        linkedSignal: () => linked.signal,
      })).finally(linked.dispose)
    },
    [channels, generation, platform.storage, runtime, store, workbench],
  )

  const promptPreparation = useMemo(
    () => ({
      graph: () => store.getSnapshot(),
      dispatch: (command: Parameters<typeof store.dispatch>[0]) =>
        store.dispatch(command),
      notify: store.notify,
      skills: () => skillStore.skills,
      presetOverrides: presetText.overrides,
      completeText,
    }),
    [completeText, presetText.overrides, skillStore.skills, store],
  )

  const applySkillIfSelected = useCallback(
    (node: NodeSnapshot<PromptData>, signal: AbortSignal) =>
      applySelectedSkill(node, signal, promptPreparation),
    [promptPreparation],
  )

  const applyComposeIfNeeded = useCallback(
    (node: NodeSnapshot<PromptData>, signal: AbortSignal) =>
      applyComposeFromDraft(node, signal, promptPreparation),
    [promptPreparation],
  )

  const runLoop = useCallback(
    (
      loopNode: Parameters<typeof runCanvasLoop>[0],
      graph: ReturnType<typeof store.getSnapshot>,
      contextAssets?: readonly GenerationContextAsset[],
      signal?: AbortSignal,
    ) => runCanvasLoop(loopNode, contextAssets, signal, {
      graph,
      getSnapshot: () => store.getSnapshot(),
      dispatch: (command) => store.dispatch(command),
      notify: store.notify,
      flush: () => store.flush(),
      activeRunNodeIds,
      launch,
    }),
    [activeRunNodeIds, launch, store],
  )

  const runNode = useCallback(
    (
      nodeId: string,
      opts?: {
        alt?: boolean
        inPlace?: boolean
        signal?: AbortSignal
        contextAssets?: readonly GenerationContextAsset[]
      },
    ) => {
      const linked = linkRunSignal(runtime.engine, opts?.signal)
      const signal = linked.signal
      return runtime.operations.track(async () => {
        let graph = store.getSnapshot()
      const node = graph.nodes.find((n) => n.id === nodeId)
      if (signal.aborted) return

      /**
       * 循环节点走**另一条路**：它自己不产图，而是把下游链路跑 N 轮。
       *
       * 这里不做成「把 N 轮塞进同一个 RunPlan」：那需要改 `buildRunPlan` 的核心
       * （为每轮复制一份下游 task、各自带该轮输入），而 `buildRunPlan` 是
       * 画布与后续工作台共用的形状，为单个节点类型改它的主流程风险太大。
       *
       * 改成**逐轮构建并执行**：每轮拿到该轮的图片切片与替换过变量的提示词，
       * 当成一次普通的「从循环节点出发的单点运行」。好处是：
       *  - 下游零改造（它看到的输入就是循环节点给的那份，与设计一致）；
       *  - 落位、写回、撤销、日志全部复用既有链路，不新增机制；
       *  - 串行天然成立（一轮 await 完再下一轮）。
       */
      if (node?.type === 'loop') {
        const result = await runLoop(
          node as NodeSnapshot<LoopData>,
          graph,
          opts?.contextAssets,
          signal,
        )
        throwPreflightForCaller(result, signal)
        return
      }

      /**
       * 融合节点走**第三条路**（产品文档 §6.23）：它不调渠道，产物来自本地像素合成。
       *
       * 放在 `runNode` 而不是节点自己的按钮里：生成入口不止一个（节点按钮、
       * 跟随栏、右键菜单、快捷键 R），写在按钮里只有那一条路会真的融合。
       * 失败一律**如实告知**（缺原图 / 缺补丁 / 比例不符 / 素材读不出来都是用户能修的事），
       * 不静默返回 —— 静默返回的表现就是「点了没反应」。
       */
      if (node?.type === 'fusion') {
        /**
         * 融合**也要留痕**（对账 #554）。
         *
         * 它走的是本地像素合成、不经过渠道引擎，于是此前**日志里一条 RunRecord 都没有**：
         * 用户点了融合只看到一条几秒后消失的提示，回头想查「为什么不融」时日志是空的 ——
         * 而同一个应用刚在别处告诉用户「原因见日志」。这一句在这里兑现。
         *
         * 记的是**人话原因**（`fuseNode` 的 `reason` 本来就是给用户看的），
         * 与渠道失败的 `errorText` 同一格；平台那格用本地哨兵，不写「未知平台」。
         */
        const startedAt = Date.now()
        const operationId = createId('op')
        const outcome = await fuseNode({ platform, store }, nodeId)
        const durationMs = Date.now() - startedAt
        /** 提示里**指路**：原因已经落进日志（可复制、可留存），这一点要说出来 */
        if (!outcome.ok) store.notify(`${outcome.reason}（已记进日志）`, 'error')
        await appendFusionRecord({
          node: node as NodeSnapshot<FusionData>,
          outcome,
          startedAt,
          durationMs,
          operationId,
          workbench,
        })
        return
      }

      /**
       * 提示词节点若**选了技能**，先把技能跑一遍，再走原来的下游链路
       * （用户 2026-09-24：「技能这个功能属于是设定，而不是进行 —— 选择好技能之后，
       *  点击生成开始生效」）。
       *
       * 语义定稿：技能正文 = **这次调用的系统指令**，与「优化 / 翻译 / 反推」
       * 走的是同一条链路（`系统指令 + 节点正文 → 文本模型 → 结果写回正文`），
       * 三者唯一的差别就是那段指令从哪来。所以这里不需要新的执行机制：
       *  - 取技能正文当 system；
       *  - 拿节点正文当 user 内容；
       *  - 结果写回正文（进撤销栈）；
       *  - 然后**继续往下跑** —— 下游生成节点读到的是改写后的正文。
       *
       * 为什么放在 `runNode` 而不是面板的按钮里：用户要的是「点生成时生效」，
       * 而「生成」的入口不止面板一个（右键菜单、快捷键 R、跟随栏）。
       * 放在这里，**所有入口一致**；放按钮里则只有面板那条路会跑技能。
       *
       * 取不到技能（被删了 / 换了项目）时**不静默跳过**：把选择清掉并告知，
       * 而不是假装跑了。否则用户会以为「技能生效了」，实际发出去的是没处理的正文。
       */
      if (node?.type === 'prompt') {
        const promptNode = node as NodeSnapshot<PromptData>
        const needsSkill = !promptNode.disabled && !!promptNode.data.skillId
        const needsCompose =
          !promptNode.disabled &&
          !(promptNode.data.text ?? '').trim() &&
          !!(promptNode.data.draft ?? '').trim()
        if (needsSkill || needsCompose) {
          if (preparingPrompt.has(nodeId)) return
          preparingPrompt.add(nodeId)
          updateCanvasRunStates(projectId, (prev) =>
            new Map(prev).set(nodeId, { kind: 'running', startedAt: Date.now() }),
          )
          try {
            const applied = await applySkillIfSelected(promptNode, signal)
            if (applied === 'failed') return
            if (applied === 'applied') {
              // 技能刚改写正文：下游规划必须读新快照，不能用进入函数时那份
              graph = store.getSnapshot()
            } else {
              const composed = await applyComposeIfNeeded(promptNode, signal)
              if (composed === 'failed') return
              if (composed === 'applied') graph = store.getSnapshot()
            }
          } finally {
            preparingPrompt.delete(nodeId)
            /**
             * 清掉「准备中」这条状态。不清的话提示词节点会一直转圈：
             * 引擎随后只给真正收产物的下游节点写状态，不会替它收尾。
             */
            updateCanvasRunStates(projectId, (prev) => {
              const next = new Map(prev)
              next.delete(nodeId)
              return next
            })
          }
          if (signal.aborted) return
        }
      }

      /**
       * 批量节点接到下游生成节点时也走**分发器**语义（用户 2026-09-24）：
       *
       * > 「批量节点的下游需要链接生图节点，所用的参数就是生图节点的参数，
       * >  点击一键生成的时候参考普通节点生成的逻辑」
       *
       * 与循环节点同一条思路，但**不需要展开轮次**：批量的集合展开是既有能力 ——
       * 下游生成节点的 `collectInputs` 本来就会把「上游是批量节点」包成
       * 一个 `collection` 项（§6.12「作为上游：集合卡」），执行计划阶段按项展开成
       * N 次调用，各铺一个承载节点。
       *
       * 所以这里只需把**起点换成下游生成节点**，其余（参数、提示词、比例跟随、
       * 落位、连线、日志、撤销）全部走「生成节点自己跑一趟」那条既有链路。
       *
       * 为什么只在**有可运行下游**时才改道：批量节点没有下游时，
       * 「在批量节点面板填提示词 + 参数，点生成 → 右侧出 N 个结果」是
       * §6.12 场景 1 / 3 的既定行为，不能丢。两条路按「下游有没有配好的生成节点」二选一。
       */
      if (node?.type === 'batch' && hasRunnableDownstream(node, graph)) {
        /**
         * 用 `candidateDownstream` 而不是「直接下游里第一个生成节点」：
         * 后者会把**批量自己产出的承载节点**也算进来（见该函数注释里
         * 2026-09-24 那个「按钮被劫持到空提示词承载节点」的实测）。
         */
        const target = candidateDownstream(node, graph)[0]
        if (target) {
          const plan = buildRunPlan(
            'node',
            { originNodeId: target.id },
            graph,
            'single',
            {
              reservedNodeIds: activeRunNodeIds(),
              ...(opts?.contextAssets?.length ? { contextAssets: opts.contextAssets } : {}),
            },
          )
          if (plan.tasks.length === 0) {
            explainEmptyPlan(target.id)
            return
          }
          const result = await launch(plan, target.id, signal)
          throwPreflightForCaller(result, signal)
          return
        }
      }

      const plan = buildRunPlan(
        'node',
        { originNodeId: nodeId },
        graph,
        opts?.alt ? 'single-alt' : 'single',
        {
          reuseOriginNode: opts?.inPlace === true,
          reservedNodeIds: activeRunNodeIds(),
          ...(opts?.contextAssets?.length ? { contextAssets: opts.contextAssets } : {}),
        },
      )
      if (plan.tasks.length === 0) {
        explainEmptyPlan(nodeId)
        return
      }
        const result = await launch(plan, nodeId, signal)
        throwPreflightForCaller(result, signal)
      }).finally(linked.dispose)
    },
    [
      store,
      launch,
      explainEmptyPlan,
      runLoop,
      applySkillIfSelected,
      applyComposeIfNeeded,
      appendFusionRecord,
      platform,
      activeRunNodeIds,
      runtime,
    ],
  )

  const runGroup = useCallback(
    (memberIds: readonly string[]) => {
      const linked = linkRunSignal(runtime.engine)
      return runtime.operations.track(async () => {
        const graph = store.getSnapshot()
        const known = new Set(graph.nodes.map((node) => node.id))
        const ids = memberIds.filter((id) => known.has(id))
        if (ids.length === 0) {
          store.notify('分组里没有可运行的节点', 'error')
          return
        }
        const plan = buildGroupRunPlan(graph, ids)
        if (plan.tasks.length === 0) {
          store.notify('组内没有配好提示词或可用上游的生成节点', 'error')
          return
        }
        const result = await launch(plan, plan.tasks[0]?.nodeId, linked.signal)
        if (!result.ok && !result.canceled) {
          throw new CanvasRunPreflightError(result.failures)
        }
      }).finally(linked.dispose)
    },
    [launch, runtime, store],
  )

  const cancel = useCallback(
    (nodeId: string) => {
      runtime.nodeScopedRunCancellation.cancelForNode(nodeId, cancelRun)
    },
    [cancelRun, runtime],
  )

  const api: CanvasExecutionApi = useMemo(
    () => ({
      runNode,
      runGroup,
      cancel,
      nodeStateOf: (nodeId: string) => nodeStates.get(nodeId),
      nodeStates,
      isRunning,
      appendRecord,
      completeText,
    }),
    [
      appendRecord,
      runNode,
      runGroup,
      cancel,
      nodeStates,
      isRunning,
      store,
      completeText,
    ],
  )

  return (
    <CanvasExecutionValueProvider value={api}>
      {children}
      {/* 执行模式快捷键（R / Alt+R / P / Shift+R / Ctrl+Enter，§6.20） */}
      <RunHotkeys />
    </CanvasExecutionValueProvider>
  )
}

export function useCanvasExecution(): CanvasExecutionApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('CanvasExecutionProvider 未挂载')
  return v
}
