import { useCallback } from 'react'
import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  activeQueueTurnOf,
  bindTurnToSessionActivity,
} from '../../../../features/canvas/agent/sessionActivity'
import {
  resumeAgentTurn,
  runAgentTurn,
  type AgentLoopDeps,
  type AgentLoopOutcome,
} from '../../agent/agentLoop'
import { outcomeTurnOriginFor } from './agentOutcomeOrigin'
import { assembleAgentLoopDeps } from './agentLoopDeps'
import { continueAgentAutoConfirmations } from './agentAutoConfirmations'
import { prepareAgentTurnRequest } from './agentTurnRequest'
import { useAgentAutoRunController } from './useAgentAutoRunController'
import { useAgentLoopDepsController } from './useAgentLoopDepsController'
import { useAgentOutcomeCoordinator } from './useAgentOutcomeCoordinator'
import { useAgentPrepareTurnController } from './useAgentPrepareTurnController'
import { useAgentSendTurnController } from './useAgentSendTurnController'
import { useAgentSendController } from './useAgentSendController'
import type { AgentPanelRefs } from './useAgentPanelRefs'
import type { AgentPanelSessionModel } from './useAgentPanelSessionModel'
import type { AgentPanelToolModel } from './useAgentPanelToolModel'

const AUTO_RUN_LIMIT = 32

export interface AgentPanelTurnCoreInput {
  session: AgentPanelSessionModel
  tool: AgentPanelToolModel
  refs: AgentPanelRefs
}

export function useAgentPanelTurnCore({
  session,
  tool,
  refs,
}: AgentPanelTurnCoreInput) {
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
    setList,
    setCurrent,
    setDraft,
    setMessages,
    setStatusFor,
    setLiveActivityFor,
    appendLiveProcessFor,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    trackRun,
    runPresentation,
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
    applySessionSnapshot,
    refresh,
    writeDraftForSession,
    setMessageReveal,
    setShowJumpToLatest,
    stickToLatestRef,
    clearReveal,
  } = session
  const {
    toolCtx,
    executeToolWithLedger,
    executeConfirmedToolWithLedger,
  } = tool
  const {
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
    clearLiveProcessFor,
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
    savePhaseEventMessages: (sessionId, messages) =>
      sessions.saveMessages(sessionId, [...messages]),
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

  return {
    turnToolsForSession,
    setAutoRun,
    autoRunFor,
    syncAutoRunFromSession,
    clearAutoRuns,
    loopDeps,
    handleOutcome,
    continueAutoConfirmations,
    prepareTurn,
    runSendText,
    sendText,
  }
}
