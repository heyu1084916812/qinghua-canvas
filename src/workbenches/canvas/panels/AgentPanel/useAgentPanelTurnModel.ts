import { useCallback, useEffect } from 'react'
import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import type { AgentDeliveryMode } from '../../../../domain/agent/delivery'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  activeQueueTurnOf,
  bindTurnToSessionActivity,
  claimSessionActivity,
  clearQueueDrain,
  isSessionActivityActive,
  queueTurnMatchesSessionActivity,
  releaseSessionActivity,
  turnMatchesSessionActivity,
} from '../../../../features/canvas/agent/sessionActivity'
import {
  resumeAgentTurn,
  runAgentTurn,
  type AgentLoopDeps,
  type AgentLoopOutcome,
} from '../../agent/agentLoop'
import {
  DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
  type TaskShutdownControl,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import { createAgentPanelShutdownControl } from './agentPanelShutdown'
import { isAdvanceTaskCommand } from './agentProcessText'
import { statusCanSteer, statusIsBusy } from './AgentActivityViews'
import { outcomeTurnOriginFor } from './agentOutcomeOrigin'
import { assembleAgentLoopDeps } from './agentLoopDeps'
import { continueAgentAutoConfirmations } from './agentAutoConfirmations'
import { runAgentConfirmation } from './agentConfirmationRun'
import { runAgentContinuation } from './agentContinuationRun'
import { prepareAgentTurnRequest } from './agentTurnRequest'
import { previewOf } from './agentConfirmationPreview'
import { useAgentAutoRunController } from './useAgentAutoRunController'
import { useAgentLoopDepsController } from './useAgentLoopDepsController'
import { useAgentOutcomeCoordinator } from './useAgentOutcomeCoordinator'
import { useAgentPrepareTurnController } from './useAgentPrepareTurnController'
import { useAgentSendTurnController } from './useAgentSendTurnController'
import { useAgentSendController } from './useAgentSendController'
import { useAgentQueueController } from './useAgentQueueController'
import { useAgentInterruptSettlementController } from './useAgentInterruptSettlementController'
import { useAgentSteeringController } from './useAgentSteeringController'
import { useAgentTaskPlanController } from './useAgentTaskPlanController'
import { useAgentConfirmationController } from './useAgentConfirmationController'
import { useAgentContinuationController } from './useAgentContinuationController'
import { useAgentStopController } from './useAgentStopController'
import type { AgentPanelRefs } from './useAgentPanelRefs'
import type { AgentPanelSessionModel } from './useAgentPanelSessionModel'
import type { AgentPanelToolModel } from './useAgentPanelToolModel'

/**
 * 自动模式下**一轮对话最多自动执行几次**。
 *
 * 「确认 → 执行 → 再确认」是可能绕圈的（模型每步都想再往下走一步）。
 * 到顶转为可继续的安全检查点，不把下一步变成新的付费确认卡。
 */
const AUTO_RUN_LIMIT = 32
const AGENT_PANEL_DISPOSE_TIMEOUT_MS =
  DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS

/**
 * 回合领域：**发送 / 队列 / 引导 / 确认 / 继续 / 停止 / 自动执行 / 任务计划**，
 * 以及所有这些路径共用的「一轮对话」顺序编排。
 *
 * ⚠️ **这里只有接线，没有顺序。** `agentSendTurnRun` / `agentConfirmationRun` /
 * `agentContinuationRun` / `agentInterruptSettlement` 里的先后一个字都没动；
 * 本文件只负责把 state 与端口摆好。
 *
 * 关停屏障（`finalize` 里那张 clear 清单）也在这里：它是**契约清单**，
 * 每加一个会话级 ref 就必须在这清掉，所以必须和 ref 的宿主看得见彼此。
 */
export interface AgentPanelTurnModelInput {
  session: AgentPanelSessionModel
  tool: AgentPanelToolModel
  refs: AgentPanelRefs
  onDisposeReady?: (
    beginShutdown: () => TaskShutdownControl,
  ) => (() => void) | void
}

export function useAgentPanelTurnModel({
  session,
  tool,
  refs,
  onDisposeReady,
}: AgentPanelTurnModelInput) {
  const {
    platform,
    store,
    selection,
    viewport,
    execution,
    channels,
    allChannels,
    allSkills,
    current,
    currentIdRef,
    listRef,
    messages,
    setList,
    setCurrent,
    setMessages,
    draft,
    setDraft,
    status,
    deliveryMode,
    runPresentation,
    setStatusFor,
    setLiveActivityFor,
    appendLiveProcessFor,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    lifecycle,
    trackRun,
    runPromiseDetached,
    sessions,
    jobs,
    controller,
    ensureAgentJob,
    transitionSessionJob,
    memory,
    reviewModel,
    canvasReviewEnabled,
    activeAgentTools,
    generationAvailability,
    modelRoute,
    routeExecution,
    cachedChatRoute,
    prepareChatRoute,
    commitChatRoute,
    clearChatRoutes,
    applySessionSnapshot,
    refresh,
    writeDraftForSession,
    cancelPendingAssetSync,
    setMessageReveal,
    setShowJumpToLatest,
    stickToLatestRef,
    setQueueMenuId,
    clearReveal,
  } = session
  const { toolCtx, executeToolWithLedger, executeConfirmedToolWithLedger } = tool
  const {
    queuePumpingRef,
    confirmingRef,
    stoppingRef,
    inFlightConfirmationRef,
    queuePumpRef,
    sessionRuntimeRef,
    abortRefs,
    toolModeRef,
    turnToolsRef,
    currentTurnIdRef,
    currentTurnJobIdRef,
    currentTurnRevisionRef,
    planAliasesRef,
    confirmRef,
    explicitMediaModelsRef,
    deliveredSteersRef,
    contextTraceRef,
  } = refs

  const turnToolsForSession = useCallback(
    (session: AgentSession): readonly ToolDeclaration[] => {
      const known = turnToolsRef.current.get(session.id)
      if (known) return known
      const allowed = new Set<string>(session.allowedToolNames ?? [])
      const restored = activeAgentTools.filter((tool) => allowed.has(tool.name))
      turnToolsRef.current.set(session.id, restored)
      return restored
    },
    [activeAgentTools],
  )
  const {
    setAutoRun,
    autoRunFor,
    syncFromSession: syncAutoRunFromSession,
    clearAutoRuns,
  } = useAgentAutoRunController({
    current,
    statusFor: runPresentation.statusFor,
    patchSession: session.patchSessionFields,
    confirmLatest: () => confirmRef.current(),
    isCurrentSession: (sessionId) =>
      currentIdRef.current === sessionId,
  })

  /**
   * AgentLoop 依赖的装配入口（端口与取值时机见 `useAgentLoopDepsController`）。
   *
   * 纯组装仍在 `agentLoopDeps.ts`；回合创建时的 controller 必须由调用方显式传入。
   */
  const loopDeps = useAgentLoopDepsController({
    store,
    channels,
    platform,
    modelRoute,
    routeExecution,
    sessions,
    jobs,
    reviewModel,
    canvasReviewEnabled,
    viewport,
    executeToolWithLedger,
    toolCtx,
    execution,
    cachedChatRoute,
    commitChatRoute,
    abortRefs,
    contextTraceRef,
    planAliasesRef,
    turnToolsRef,
    deliveredSteersRef,
    appendLiveProcessFor,
    setLiveActivityFor,
    setStatusFor,
    activeAgentTools,
    assemble: assembleAgentLoopDeps,
  })

  const handleOutcome = useAgentOutcomeCoordinator({
    currentIdRef,
    abortRefs,
    deliveredSteersRef,
    turnToolsRef,
    sessions,
    transitionSessionJob,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    setMessageReveal,
    setMessages,
    applySessionSnapshot,
    setStatusFor,
    refresh,
    turnOriginFor: (session, persistedTurn) =>
      outcomeTurnOriginFor({
        session,
        persistedTurn,
        refs: {
          currentTurnJobId: currentTurnJobIdRef,
          currentTurnId: currentTurnIdRef,
          currentTurnRevision: currentTurnRevisionRef,
        },
        controller,
        activeQueueTurnOf,
      }),
  })

  /**
   * 真正干活的那一段：**接收正文本身**，不读 `draft`。
   *
   * 这样「重试」才能复用同一条路（用户 2026-10-14 第 1 条：助手回复下方要有
   * 复制 / 重试）。重试要拿的是**上一条用户消息**，而不是输入框里此刻的内容。
   */
  /**
   * 自动模式统一续跑入口。
   *
   * 初次发送、用户在确认卡上切自动、检查点“继续任务”都必须走这里；
   * 否则某条入口只确认了当前一张卡，下一张又会重新弹出来。
   */
  const continueAutoConfirmations = useCallback(async (
    session: AgentSession,
    initial: AgentLoopOutcome,
    currentLoopDeps: AgentLoopDeps,
    onMessages: (next: ChatMessage[]) => void,
  ): Promise<AgentLoopOutcome> =>
    continueAgentAutoConfirmations({
      session,
      initial,
      loopDeps: currentLoopDeps,
      autoRun: () => autoRunFor(session.id),
      maxSteps: AUTO_RUN_LIMIT,
      turnOrigin: () => ({
        jobId:
          currentTurnJobIdRef.current.get(session.id) ??
          controller.jobId(session.id),
        turnId:
          activeQueueTurnOf(session.id) ??
          currentTurnIdRef.current.get(session.id) ??
          controller.turnId(session.id),
        queueTurnId: activeQueueTurnOf(session.id),
      }),
      transitionSessionJob,
      executeConfirmedTool: executeConfirmedToolWithLedger,
      finishConfirmedTool: controller.finishConfirmedTool,
      onMessages,
      setStatus: setStatusFor,
      resumeAgentTurn,
    }),
    [
      controller,
      executeConfirmedToolWithLedger,
      setStatusFor,
      transitionSessionJob,
    ])

  /**
   * 把 `prepareAgentTurnRequest` 的静态入参接好；两个顺序回调由发送主体提供
   * （端口与快照时机见 `useAgentPrepareTurnController`）。
   */
  const prepareTurn = useAgentPrepareTurnController({
    store,
    platform,
    prepareChatRoute,
    selection,
    sessions,
    memory,
    allSkills,
    allChannels,
    canvasReviewEnabled,
    activeAgentTools,
    generationAvailability,
    routeExecution,
    prepare: prepareAgentTurnRequest,
  })

  const runSendText = useAgentSendTurnController({
    currentTurnJobIdRef,
    currentTurnIdRef,
    currentTurnRevisionRef,
    abortRefs,
    contextTraceRef,
    toolModeRef,
    explicitMediaModelsRef,
    turnToolsRef,
    currentIdRef,
    sessionRuntime: sessionRuntimeRef,
    setList,
    setCurrent,
    setDraft,
    writeDraftForSession,
    setMessages,
    setStatusFor,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    clearReveal,
    trackRun,
    updateSessionFields: sessions.updateFields,
    failTurn: controller.failTurn,
    ensureJob: ensureAgentJob,
    transitionSessionJob,
    loopDeps,
    runAgentTurn,
    continueAutoConfirmations,
    handleOutcome,
    bindTurnToSessionActivity,
    syncAutoRunFromSession,
    prepareTurn,
  })

  const sendText = useAgentSendController({
    current,
    currentIdRef,
    stickToLatestRef,
    setShowJumpToLatest,
    controller,
    abortRefs,
    deliveredSteersRef,
    runSendText,
    applySessionSnapshot,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    setStatusFor,
    transitionSessionJob,
    queuePumpRef,
    trackRun,
  })

  const {
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
  } = useAgentQueueController({
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
    notify: store.notify,
    queuePumpingRef,
    queuePumpRef,
    trackRun,
    saveDraft: writeDraftForSession,
  })

  /**
   * 用户主动取消 / 停止时唯一的收口。
   *
   * 必须先 abort，再清持久化确认卡（顺序与所有权判定见
   * `agentInterruptSettlement.ts`，origin 回退见 `agentInterruptOrigin.ts`）。
   */
  const settleInterruptedSession = useAgentInterruptSettlementController({
    controller,
    activeQueueTurnOf,
    currentIdRef,
    refs: {
      abort: abortRefs,
      deliveredSteers: deliveredSteersRef,
      inFlightConfirmation: inFlightConfirmationRef,
      currentTurnId: currentTurnIdRef,
      currentTurnJobId: currentTurnJobIdRef,
      currentTurnRevision: currentTurnRevisionRef,
    },
    isActivityActive: isSessionActivityActive,
    turnMatchesActivity: turnMatchesSessionActivity,
    queueTurnMatchesActivity: queueTurnMatchesSessionActivity,
    clearQueueDrain,
    settleSession: sessions.settleInterruptedSession,
    transitionSessionJob,
    removeSteers: sessions.removeSteers,
    releaseActivity: releaseSessionActivity,
    applySessionSnapshot,
    setMessages,
    clearLiveActivities: clearLiveActivitiesFor,
    clearLiveProcess: clearLiveProcessFor,
    clearRunTasks: clearRunTasksFor,
    setStatus: setStatusFor,
    notify: store.notify,
  })

  const { guideQueuedTurn, guideDraft } =
    useAgentSteeringController({
      current,
      statusFor: runPresentation.statusFor,
      isCurrentSession: (sessionId) =>
        currentIdRef.current === sessionId,
      trackRun,
      queueText,
      sendText,
      settleInterruptedSession,
      removeQueuedTurn: sessions.removeQueuedTurn,
      promoteQueuedTurnToSteer:
        sessions.promoteQueuedTurnToSteer,
      enqueueSteer: sessions.enqueueSteer,
      getQueuedJob: (sessionId, turnId) =>
        jobs.forTurn(sessionId, turnId),
      cancelQueuedJob: async (jobId) => {
        await jobs.transition(
          jobId,
          'canceled',
          'canceled',
          {},
          { reason: 'promoted_to_steer' },
        )
      },
      applySessionSnapshot,
      setDraft,
      writeDraftForSession,
      setQueueMenuId,
      notify: store.notify,
    })

  const { advanceTaskPlan, isAdvancingTaskPlan } =
    useAgentTaskPlanController({
      statusFor: runPresentation.statusFor,
      trackRun,
      abortSession: (sessionId) => {
        abortRefs.current.get(sessionId)?.abort()
      },
      isActivityActive: isSessionActivityActive,
      clearRunPresentationFor: (sessionId) => {
        clearLiveActivitiesFor(sessionId)
        clearLiveProcessFor(sessionId)
        clearRunTasksFor(sessionId)
      },
      setStatusFor,
      updateSessionFields: sessions.updateFields,
      applySessionSnapshot,
      settleInterruptedSession,
      sendText,
      isCurrentSession: (sessionId) =>
        currentIdRef.current === sessionId,
      notify: store.notify,
    })

  /** 输入框发送：空闲直接跑；忙碌时按当前“排队 / 引导”模式投递。 */
  const send = useCallback(
    (requestedMode: AgentDeliveryMode = deliveryMode) => {
      if (!draft.trim()) return
      if (current?.taskPlan && isAdvanceTaskCommand(draft)) {
        setDraft('')
        writeDraftForSession(current.id, '')
        runPromiseDetached(
          advanceTaskPlan(current),
          '推进任务计划失败',
        )
        return
      }
      if (
        statusIsBusy(status) ||
        (current && isSessionActivityActive(current.id))
      ) {
        if (requestedMode === 'steer' && statusCanSteer(status)) {
          runPromiseDetached(guideDraft(draft), '发送引导失败')
        } else {
          runPromiseDetached(queueText(draft), '排队失败')
        }
        return
      }
      runPromiseDetached(sendText(draft), '发送失败')
    },
    [
      advanceTaskPlan,
      current,
      deliveryMode,
      draft,
      guideDraft,
      queueText,
      runPromiseDetached,
      sendText,
      status,
    ],
  )

  /**
   * 重试：把**上一条用户消息**原样再发一次（用户 2026-10-14 第 1 条）。
   * 取 `display`（带引用 chip 的原文）而不是 `content`：重试时要连引用一起还原。
   */
  const retry = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    const text = lastUser.display ?? lastUser.content
    if (statusIsBusy(status) || (current && isSessionActivityActive(current.id))) {
      runPromiseDetached(queueText(text), '排队失败')
    } else {
      runPromiseDetached(sendText(text), '发送失败')
    }
  }, [
    current,
    messages,
    queueText,
    runPromiseDetached,
    sendText,
    status,
  ])

  /**
   * 确认卡的两个动作（确认 / 取消）走同一个控制器：它们共用 `confirmingRef`，
   * 互斥语义必须待在一个文件里才看得见。`confirmRef` 仍在这里赋值，
   * 供自动执行路径的 `confirmLatest` 调用。
   */
  const { confirm, cancel } = useAgentConfirmationController({
    current,
    status,
    messages,
    confirmingRef,
    inFlightConfirmationRef,
    currentTurnJobIdRef,
    currentTurnIdRef,
    currentTurnRevisionRef,
    activeQueueTurnOf,
    controller,
    runConfirmation: runAgentConfirmation,
    executeConfirmedTool: executeConfirmedToolWithLedger,
    loopDeps,
    toolModeRef,
    turnToolsForSession,
    resumeAgentTurn,
    continueAutoConfirmations,
    handleOutcome,
    settleSessionOutcome,
    transitionSessionJob,
    abortRefs,
    currentIdRef,
    setStatusFor,
    setMessages,
    settleInterruptedSession,
    trackRun,
    notify: store.notify,
  })
  confirmRef.current = confirm

  /** 轮数预算暂停后继续；工具结果已在 messages 中，不会重放已完成的调用。 */
  const continueTask = useAgentContinuationController({
    current,
    status,
    messages,
    controller,
    activeQueueTurnOf,
    currentTurnJobIdRef,
    currentTurnIdRef,
    currentTurnRevisionRef,
    isActivityActive: isSessionActivityActive,
    claimActivity: claimSessionActivity,
    applySessionSnapshot,
    ensureRoute: prepareChatRoute,
    loopDeps,
    toolModeRef,
    turnToolsForSession,
    transitionSessionJob,
    abortRefs,
    setStatusFor,
    runAgentTurn,
    continueAutoConfirmations,
    handleOutcome,
    settleSessionOutcome,
    currentIdRef,
    setMessages,
    trackRun,
    runContinuation: runAgentContinuation,
  })

  const stop = useAgentStopController({
    current,
    status,
    inFlightConfirmationRef,
    stoppingRef,
    settleInterruptedSession,
    notify: store.notify,
    trackRun,
  })

  const pendingPlan = previewOf(status, store)
  const advancingTaskPlan = current
    ? isAdvancingTaskPlan(current.id)
    : false
  const editingQueueTurn =
    current?.queuedTurns.find((turn) => turn.id === editingQueueId) ?? null
  const pendingTaskStepId =
    status.kind === 'awaitingConfirm' &&
    status.request.name === 'requestTaskConfirmation'
      ? (() => {
          const args = (status.request.args ?? {}) as Record<string, unknown>
          return typeof args.stepId === 'string' ? args.stepId : undefined
        })()
      : undefined

  /**
   * 关停屏障：先停后续的写，再把这一轮的瞬时状态整体清掉。
   *
   * 下面那张 clear 清单**本身就是契约**：每加一个会话级 ref / 每加一个按会话
   * 分桶的控制器，都必须在这里被清掉，否则面板关了任务还在后台跑。
   */
  useEffect(() => {
    if (!onDisposeReady) return
    const beginShutdown = (): TaskShutdownControl => {
      const finalize = () => {
        cancelPendingAssetSync()
        const sessionIds = new Set([
          ...abortRefs.current.keys(),
          ...listRef.current.map((session) => session.id),
        ])
        for (const sessionId of sessionIds) {
          clearQueueDrain(sessionId)
          releaseSessionActivity(sessionId)
          sessionRuntimeRef.current.clearSession(sessionId)
          clearLiveActivitiesFor(sessionId)
          clearLiveProcessFor(sessionId)
          clearRunTasksFor(sessionId)
        }
        queuePumpingRef.current.clear()
        confirmingRef.current.clear()
        stoppingRef.current.clear()
        abortRefs.current.clear()
        deliveredSteersRef.current.clear()
        toolModeRef.current.clear()
        turnToolsRef.current.clear()
        currentTurnIdRef.current.clear()
        currentTurnJobIdRef.current.clear()
        currentTurnRevisionRef.current.clear()
        planAliasesRef.current.clear()
        clearAutoRuns()
        explicitMediaModelsRef.current.clear()
        clearChatRoutes()
        contextTraceRef.current.clear()
        inFlightConfirmationRef.current.clear()
      }
      const shutdown = createAgentPanelShutdownControl({
        lifecycle,
        flush: () => store.flush(),
        timeoutMs: AGENT_PANEL_DISPOSE_TIMEOUT_MS,
        onFinalize: finalize,
      })
      for (const controller of abortRefs.current.values()) {
        controller.abort()
      }
      return shutdown
    }
    return onDisposeReady(beginShutdown)
  }, [
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    clearAutoRuns,
    clearChatRoutes,
    cancelPendingAssetSync,
    lifecycle,
    onDisposeReady,
    store,
  ])

  return {
    send,
    retry,
    stop,
    confirm,
    cancel,
    continueTask,
    advanceTaskPlan,
    guideDraft,
    guideQueuedTurn,
    queueText,
    removeQueued,
    beginQueueEdit,
    commitQueueEdit,
    resumeQueue,
    editingQueueId,
    editingQueueText,
    setEditingQueueId,
    setEditingQueueText,
    setAutoRun,
    deliveryMode,
    pendingPlan,
    advancingTaskPlan,
    editingQueueTurn,
    pendingTaskStepId,
  }
}

export type AgentPanelTurnModel = ReturnType<typeof useAgentPanelTurnModel>
