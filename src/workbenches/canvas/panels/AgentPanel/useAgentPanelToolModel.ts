import { useCallback, useMemo } from 'react'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { resolveDefaults } from '../../../../features/canvas/createNodeWithDefaults'
import { cropAsset, extractSelection } from '../../../../features/canvas/extractSelection'
import { splitNodeToGrid } from '../../../../features/canvas/splitToGrid'
import { loadInspirationSources } from '../../../../state/project/inspirationSourceStore'
import { createPresetStore } from '../../../../state/project/presetStore'
import { runDesignResearch } from '../../../../features/shared/research/designResearchRunner'
import { TAVILY_API_KEY_REF } from '../../../../features/shared/research/tavilySearch'
import { readWebPage } from '../../../../features/shared/research/webPageReader'
import { getAgentWebResearch } from '../../../../state/ui/agentWebResearch'
import {
  executeConfirmedTool,
  type AgentToolContext,
} from '../../agent/tools'
import {
  AgentToolEffectBlockedError,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import type { AgentToolRequest } from '../../agent/agentLoop'
import { errText } from '../../agent/agentLoop'
import { createAgentToolRecipeContext } from './agentToolRecipeContext'
import { createAgentToolPlanPorts } from './agentToolPlanPorts'
import { createAgentToolCanvasOps } from './agentToolCanvasOps'
import { composeAgentToolContext } from './agentToolContext'
import { createAgentToolExecution } from './agentToolExecution'
import { createAgentToolResearch } from './agentToolResearch'
import { createAgentToolDefaults } from './agentToolDefaults'
import { runAgentCanvasNodes } from './agentCanvasRun'
import { originOf, viewportWorldOf } from './agentPanelViewHelpers'
import type { AgentPanelRefs } from './useAgentPanelRefs'
import type { AgentPanelSessionModel } from './useAgentPanelSessionModel'

/**
 * 工具领域：**工具上下文（`toolCtx`）+ 执行账本**。
 *
 * 这一层只做一件事：把「此刻的面板状态」接成 `AgentToolContext`。它的价值全在
 * **取值时机**上，所以下面的三条铁律一个字都没动：
 * - `signal` 是 thunk（调用时现取），写成值快照会让停止按钮关不掉正在跑的生成；
 * - `perImage` 建 ctx 时现读；
 * - `resolveAliases` / 上下文素材调用时现取。
 *
 * 本文件不持有任何 state / ref：所有会话桶都由 `useAgentPanelRefs` 提供。
 */
export interface AgentPanelToolModelInput {
  session: AgentPanelSessionModel
  refs: AgentPanelRefs
}

export function useAgentPanelToolModel({
  session,
  refs,
}: AgentPanelToolModelInput) {
  const {
    platform,
    store,
    selection,
    viewport,
    execution,
    channels,
    current,
    enabled,
    allChannels,
    selectedModelOf,
    sessions,
    inspirationRepository,
    memory,
    runTrackedDetached,
    trackRun,
    setList,
    setCurrent,
    setRunTasksFor,
    currentIdRef,
    controller,
    jobs,
    toolEffects,
  } = session
  const {
    sessionRuntimeRef,
    abortRefs,
    contextTraceRef,
    planAliasesRef,
    explicitMediaModelsRef,
  } = refs

  const toolCtx = useCallback(
    (
      origin: { x: number; y: number },
      session: AgentSession | undefined = current ?? undefined,
    ): AgentToolContext => {
      const sessionId = session?.id ?? ''
      /**
       * 生成配方的取值逻辑（模型优先级 + 渠道反查 + 上下文素材过滤）整体搬到
       * `agentToolRecipeContext` 里，这里只负责把「此刻最新」的状态以 getter 形式接进去。
       *
       * 必须逐次调用创建：`sessionId` / `session` 是这一次工具调用的作用域，
       * 而且 getter 要读 ref，才能保证批准后才执行的工具看到的是最新值。
       */
      const recipeContext = createAgentToolRecipeContext({
        sessionId,
        session,
        getExplicitMediaModels: () =>
          explicitMediaModelsRef.current.get(sessionId),
        getStickyModels: () =>
          sessionRuntimeRef.current.stickyModelsFor(sessionId),
        selectedModelOf,
        allChannels,
        enabledChannels: enabled,
        getContextAssets: () =>
          contextTraceRef.current.get(sessionId)?.assetRefs ?? [],
        rememberStickyModel: (targetId, kind, model) =>
          sessionRuntimeRef.current.rememberStickyModel(targetId, kind, model),
        persistStickyModel: (targetId, kind, model) => {
          runTrackedDetached(
            () =>
              sessions.updateFields(
                targetId,
                kind === 'video'
                  ? { videoModel: model }
                  : { imageModel: model },
              ),
            '保存生成模型失败',
          )
        },
      })
      /**
       * `signal` 必须是**每次调用现取**的 thunk：调研是长任务，跑起来那一刻才决定用哪个
       * 取消信号；写成值快照会拿上一回合的 AbortController，停止按钮关不掉、继续扣费。
       */
      const toolResearch = createAgentToolResearch({
        remember: (candidate) => memory.remember(candidate),
        readCachedSources: () => inspirationRepository.readAll(),
        readConfiguredSources: () => loadInspirationSources(platform.storage),
        readWebSearch: () => createPresetStore(platform.storage).loadAgentWebSearch(),
        /** Key 走凭据端口（桌面壳为 DPAPI），只在 Tavily 请求头里出现。 */
        readTavilyKey: () => platform.credentials.load(TAVILY_API_KEY_REF),
        webEnabled: getAgentWebResearch,
        readPage: readWebPage,
        network: platform.network,
        runResearch: runDesignResearch,
        signal: () =>
          abortRefs.current.get(sessionId)?.signal ??
          new AbortController().signal,
        describeError: errText,
      })
      /** agent 建的节点要和手建的节点使用同一套默认值（串行取值顺序由模块保证）。 */
      const toolDefaults = createAgentToolDefaults({
        defaultsFor: (type) => resolveDefaults({ channels, type }),
      })
      /** 跑节点 / 裁剪 / 宫格切分：上下文素材用**调用时现取**的 thunk。 */
      const canvasOps = createAgentToolCanvasOps({
        sessionId,
        store,
        platform,
        execution,
        channels,
        setRunTasksFor,
        runCanvasNodes: runAgentCanvasNodes,
        cropAsset,
        extractSelection,
        splitNodeToGrid,
        getContextAssets: () =>
          contextTraceRef.current.get(sessionId)?.assetRefs,
      })
      return composeAgentToolContext({
        base: {
          store,
          origin,
          viewportWorld: viewportWorldOf(viewport),
          projectId: store.getSnapshot().projectId,
          sessionId,
          selection,
          selectedModelOf,
          // 建 ctx 时现读：批准后才执行的工具要跟随**本回合**的停止信号。
          abortSignal: abortRefs.current.get(sessionId)?.signal,
          perImage: sessionRuntimeRef.current.isPerImage(sessionId),
        },
        plan: sessionId
          ? createAgentToolPlanPorts({
              sessionId,
              getSession: sessions.get,
              updateFields: sessions.updateFields,
              trackRun,
              setList,
              setCurrent,
              currentIdRef,
            })
          : undefined,
        // 调用时现取：applyPlan 之后才写别名，不能在 build 时快照。
        resolveAliases: () => planAliasesRef.current.get(sessionId),
        recipe: recipeContext,
        research: toolResearch,
        defaults: toolDefaults,
        canvasOps,
      })
    },
    /**
     * 依赖集合不因这次拆分而变化：`toolResearch` / `toolDefaults` 都在函数体内创建，
     * 只闭包下面这些变量。把它们提到组件级、再把对象塞进这里，就等于把
     * 「调用即取」换成渲染时快照（`signal` 还会丢 sessionId）。
     */
    [
      store,
      selection,
      execution,
      channels,
      current,
      enabled,
      allChannels,
      selectedModelOf,
      sessions,
      platform,
      inspirationRepository,
      memory,
      viewport,
      runTrackedDetached,
    ],
  )
  /**
   * 确认型工具只执行一次（回放 / needs_attention / 冲突语义见 `agentToolExecution.ts`）。
   *
   * 这里只把 panel 的 controller / jobs / sessions / store 接成端口；
   * 账本判断本身不读 React、不读单例，便于单测钉住每条分支。
   */
  const toolExecution = useMemo(
    () =>
      createAgentToolExecution({
        resolveJobId: (sessionId) =>
          controller.jobId(sessionId) ??
          jobs.active(sessionId).then((job) => job?.id),
        getSession: (sessionId) => sessions.get(sessionId),
        run: (input) => toolEffects.run(input),
        notify: (message, tone) => store.notify(message, tone),
        createBlockedError: AgentToolEffectBlockedError,
      }),
    [controller, jobs, sessions, store, toolEffects],
  )

  const executeToolWithLedger = useCallback(
    (
      sessionId: string,
      request: AgentToolRequest,
      execute: () => Promise<unknown>,
    ): Promise<unknown> =>
      toolExecution.executeWithLedger(sessionId, request, execute),
    [toolExecution],
  )

  const executeConfirmedToolWithLedger = useCallback(
    (session: AgentSession, request: AgentToolRequest): Promise<unknown> =>
      toolExecution.executeConfirmedWithLedger(session, request, (target) =>
        executeConfirmedTool(
          request.name,
          request.args,
          toolCtx(originOf(viewport), target),
        ),
      ),
    [toolExecution, toolCtx, viewport],
  )

  return {
    toolCtx,
    toolExecution,
    executeToolWithLedger,
    executeConfirmedToolWithLedger,
  }
}

export type AgentPanelToolModel = ReturnType<typeof useAgentPanelToolModel>
