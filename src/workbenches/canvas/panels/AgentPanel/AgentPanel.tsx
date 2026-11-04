import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSyncExternalStore } from 'react'
import { usePlatform } from '../../../../app/providers/PlatformProvider'
import { useChannels } from '../../../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../../../app/providers/SkillStoreProvider'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  createAgentSessionStore,
  type AgentSession,
} from '../../../../state/agent/sessionStore'
import { createAgentJobStore } from '../../../../state/agent/jobStore'
import type { AgentDeliveryMode } from '../../../../domain/agent/delivery'
import { createPresetStore } from '../../../../state/project/presetStore'
import {
  generationAvailabilityOf,
} from '../../../../domain/project/generationRouting'
import { resolveDefaults } from '../../../../features/canvas/createNodeWithDefaults'
import { cropAsset, extractSelection } from '../../../../features/canvas/extractSelection'
import { splitNodeToGrid } from '../../../../features/canvas/splitToGrid'
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
import { createAssetLibraryRepository } from '../../../../state/project/assetLibraryRepository'
import { createAssetLibraryStore } from '../../../../state/project/assetLibraryStore'
import { createInspirationRepository } from '../../../../state/project/inspirationRepository'
import { loadInspirationSources } from '../../../../state/project/inspirationSourceStore'
import { runDesignResearch } from '../../../../features/shared/research/designResearchRunner'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { useCanvasStore, useGraph, useSelection } from '../../storeContext'
import { useViewportState } from '../../storeContext'
import type { ToolDeclaration } from '../../../../domain/shared/execution/types'
import {
  resumeAgentTurn,
  runAgentTurn,
  type AgentLoopDeps,
  type AgentLoopOutcome,
  type AgentToolRequest,
} from '../../agent/agentLoop'
import {
  agentToolsForCapabilities,
  executeConfirmedTool,
  type AgentToolContext,
} from '../../agent/tools'
import { createAgentController } from '../../../../features/shared/agent/AgentController'
import { createAgentMemoryPort } from '../../../../features/shared/agent/MemoryPort'
import {
  AgentToolEffectBlockedError,
  createAgentToolEffectLedger,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import {
  DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
  TaskLifecycleClosedError,
  createTaskLifecycle,
  type TaskLifecycle,
  type TaskShutdownControl,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import { createContextRepository } from '../../../../state/shared/contextRepository'
import { createAgentPanelShutdownControl } from './agentPanelShutdown'
import {
  getAgentDeliveryMode,
  setAgentDeliveryMode,
  subscribeAgentDeliveryMode,
} from '../../../../state/ui/agentDelivery'
import {
  getAgentReviewModel,
  setAgentReviewModel,
  subscribeAgentReviewModel,
} from '../../../../state/ui/agentReviewModel'
import {
  getAgentCanvasReview,
  setAgentCanvasReview,
  subscribeAgentCanvasReview,
} from '../../../../state/ui/agentCanvasReview'
import {
  buildAssetHashByNode,
  buildConversationItems,
  buildNodeTitles,
  currentTurnHasProcessOf,
  latestProcessIndexOf,
  latestUserStartedAtOf,
  nodeLabelOf as conversationNodeLabelOf,
} from './agentConversationItems'
import { createAgentToolRecipeContext } from './agentToolRecipeContext'
import { createAgentToolPlanPorts } from './agentToolPlanPorts'
import { createAgentToolCanvasOps } from './agentToolCanvasOps'
import { composeAgentToolContext } from './agentToolContext'
import { createAgentToolExecution } from './agentToolExecution'
import { createAgentToolResearch } from './agentToolResearch'
import { createAgentToolDefaults } from './agentToolDefaults'
import { isAdvanceTaskCommand } from './agentProcessText'
import { useAgentSendTurnController } from './useAgentSendTurnController'
import { useAgentConfirmationController } from './useAgentConfirmationController'
import { useAgentContinuationController } from './useAgentContinuationController'
import { useAgentStopController } from './useAgentStopController'
import { useAgentLoopDepsController } from './useAgentLoopDepsController'
import type { AgentPrepareArgs } from './agentSendTurnRun'
import {
  useAgentConversationController,
  type AgentMessageReveal,
} from './useAgentConversationController'
import { useAgentComposerController } from './useAgentComposerController'
import { useAgentAttachmentsController } from './useAgentAttachmentsController'
import { useAgentChatRouting } from './useAgentChatRouting'
import { useAgentModelSelectionController } from './useAgentModelSelectionController'
import { useAgentAutoRunController } from './useAgentAutoRunController'
import { useAgentSteeringController } from './useAgentSteeringController'
import { useAgentSessionLifecycle } from './useAgentSessionLifecycle'
import { useAgentSessionActionsController } from './useAgentSessionActionsController'
import { useAgentTaskPlanController } from './useAgentTaskPlanController'
import { useAgentInitialLoadController } from './useAgentInitialLoadController'
import { useAgentSkillsController } from './useAgentSkillsController'
import { AgentSessionRuntimeState } from './agentSessionRuntime'
import {
  prepareAgentTurnRequest,
  type AgentTurnContextTrace,
} from './agentTurnRequest'
import { errText } from '../../agent/agentLoop'
import {
  IDLE_STATUS,
  statusCanSteer,
  statusIsBusy,
  type AgentPanelStatus as Status,
} from './AgentActivityViews'
import type { AgentQueueMenuPosition } from './AgentQueuePanel'
import { AgentPanelView } from './AgentPanelView'
import { useAgentQueueController } from './useAgentQueueController'
import { useAgentSendController } from './useAgentSendController'
import { useAgentOutcomeCoordinator } from './useAgentOutcomeCoordinator'
import { assembleAgentLoopDeps } from './agentLoopDeps'
import { continueAgentAutoConfirmations } from './agentAutoConfirmations'
import { runAgentConfirmation } from './agentConfirmationRun'
import { runAgentContinuation } from './agentContinuationRun'
import { useAgentInterruptSettlementController } from './useAgentInterruptSettlementController'
import { runAgentCanvasNodes } from './agentCanvasRun'
import { useAgentRunPresentation } from './useAgentRunPresentation'
import { previewOf } from './agentConfirmationPreview'
import { originOf, viewportWorldOf } from './agentPanelViewHelpers'
import {
  parseMentions,
} from '../../text/MentionEditor'

/**
 * 画布右侧的 Agent 对话窗（设计文档 §7 / §8）。
 *
 * 界面把循环的三种「停法」如实呈现出来 —— 这是设计里最容易被做糊的一处：
 * 只有一个转圈的话，用户分不清它是**在想**、**在建**、还是**在等他点确认**。
 */

/**
 * 自动模式下**一轮对话最多自动执行几次**。
 *
 * 「确认 → 执行 → 再确认」是可能绕圈的（模型每步都想再往下走一步）。
 * 到顶转为可继续的安全检查点，不把下一步变成新的付费确认卡。
 */
const AUTO_RUN_LIMIT = 32
const AGENT_PANEL_DISPOSE_TIMEOUT_MS =
  DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS

type AgentSessionPatch = Partial<
  Omit<
    AgentSession,
    'id' | 'projectId' | 'messages' | 'queuedTurns' | 'createdAt'
  >
>

export function AgentPanel({
  projectId,
  active = true,
  onClose,
  onOpenSettings,
  onDisposeReady,
}: {
  projectId: string
  /** 常驻宿主仍可处于后台；只有当前可见画布才接收一次性 handoff。 */
  active?: boolean
  onClose: () => void
  onOpenSettings: () => void
  onDisposeReady?: (
    beginShutdown: () => TaskShutdownControl,
  ) => (() => void) | void
}) {
  const platform = usePlatform()
  const channels = useChannels()
  const store = useCanvasStore()
  const selection = useSelection()
  const viewport = useViewportState()
  const execution = useCanvasExecution()
  const skills = useSkillsOptional()

  const runPresentation = useAgentRunPresentation()
  const {
    setStatusFor,
    setRunTasksFor,
    clearRunTasksFor,
    setLiveActivityFor,
    clearLiveActivitiesFor,
    appendLiveProcessFor,
    clearLiveProcessFor,
  } = runPresentation

  const controller = useMemo(
    () =>
      createAgentController({
        projectId,
        sessions: createAgentSessionStore(platform.storage),
        jobs: createAgentJobStore(platform.storage),
        hooks: {
          isSessionActivityActive,
          onPendingConfirmation: (sessionId, request) => {
            setStatusFor(sessionId, { kind: 'awaitingConfirm', request })
          },
          onContinuation: (sessionId, maxSteps) => {
            setStatusFor(sessionId, {
              kind: 'paused',
              message: `已完成 ${maxSteps} 步，可继续`,
            })
          },
          onNeedsAttention: (sessionId, message) => {
            setStatusFor(sessionId, { kind: 'error', message })
          },
          onIdle: (sessionId) => setStatusFor(sessionId, IDLE_STATUS),
          notify: (message, tone) => store.notify(message, tone),
        },
      }),
    [platform.storage, projectId, setStatusFor, store],
  )
  const { sessions, jobs } = controller
  const ensureAgentJob = controller.ensureJob
  const transitionSessionJob = controller.transition
  const toolEffects = useMemo(() => createAgentToolEffectLedger(jobs), [jobs])
  const memory = useMemo(
    () => createAgentMemoryPort(createContextRepository(platform.storage)),
    [platform],
  )
  const presets = useMemo(() => createPresetStore(platform.storage), [platform])
  /**
   * 素材库（用户 2026-10-03：「加素材…分两个功能，点击后本地上传和素材库添加」）。
   *
   * 素材库 store 原先只在素材页里就地建；这里按同一套工厂再建一份（同一个
   * `platform.storage`、同一张 `assetLibrary` 表）—— 不新增全局 provider，
   * 因为画布页与素材页本来就各用各的一份，读的是同一份数据。
   */
  const library = useMemo(
    () => createAssetLibraryStore(createAssetLibraryRepository(platform.storage)),
    [platform],
  )
  const inspirationRepository = useMemo(
    () => createInspirationRepository(platform.storage, platform.network),
    [platform],
  )
  const libraryAssets = useSyncExternalStore(
    library.subscribe,
    () => library.getState().assets,
    () => library.getState().assets,
  )

  const lifecycleRef = useRef<TaskLifecycle | null>(null)
  if (!lifecycleRef.current) {
    lifecycleRef.current = createTaskLifecycle()
  }
  const lifecycle = lifecycleRef.current
  const trackRun = useCallback<TaskLifecycle['track']>(
    (work) => lifecycle.track(work),
    [lifecycle],
  )
  const composerResetForSessionRef = useRef<(sessionId: string) => void>(
    () => {},
  )
  const conversationResetForSessionRef = useRef<(sessionId: string) => void>(
    () => {},
  )
  const sessionActionsResetRef = useRef<() => void>(() => {})
  const onSessionSwitched = useCallback((session: AgentSession) => {
    composerResetForSessionRef.current(session.id)
    conversationResetForSessionRef.current(session.id)
    sessionActionsResetRef.current()
  }, [])
  const {
    list,
    current,
    messages,
    setList,
    setCurrent,
    setMessages,
    listRef,
    currentIdRef,
    selectionVersionRef,
    refresh,
    switchTo,
    applySessionSnapshot: applySessionLifecycleSnapshot,
    patchSession: patchSessionFields,
    renameSession,
    removeSession,
  } = useAgentSessionLifecycle({
    track: trackRun,
    controllerRefresh: controller.refresh,
    sessionsGet: sessions.get,
    sessionsMessagesFor: sessions.messagesFor,
    sessionsUpdateFields: sessions.updateFields,
    sessionsRename: sessions.rename,
    sessionsRemove: sessions.remove,
    onSwitched: onSessionSwitched,
  })
  /** 当前会话那一份运行态（别的会话在跑不影响这里） */
  const status: Status = current
    ? runPresentation.statusFor(current.id)
    : IDLE_STATUS
  const runTasks = current
    ? runPresentation.runTasksFor(current.id)
    : undefined
  const liveActivities = current
    ? runPresentation.liveActivitiesFor(current.id)
    : []
  const liveProcess = current
    ? runPresentation.liveProcessFor(current.id)
    : ''
  const deliveryMode = useSyncExternalStore(
    subscribeAgentDeliveryMode,
    getAgentDeliveryMode,
    getAgentDeliveryMode,
  )
  const reviewModel = useSyncExternalStore(
    subscribeAgentReviewModel,
    getAgentReviewModel,
    getAgentReviewModel,
  )
  const canvasReviewEnabled = useSyncExternalStore(
    subscribeAgentCanvasReview,
    getAgentCanvasReview,
    getAgentCanvasReview,
  )
  const activeAgentTools = useMemo(
    () => agentToolsForCapabilities({ canvasReview: canvasReviewEnabled }),
    [canvasReviewEnabled],
  )
  const queuePumpingRef = useRef(new Set<string>())
  const confirmingRef = useRef(new Set<string>())
  const stoppingRef = useRef(new Set<string>())
  /** 已批准、正在执行的确认工具；停止时要给这条 tool_call 补一个中断结果。 */
  const inFlightConfirmationRef = useRef(new Map<string, AgentToolRequest>())
  const queuePumpRef = useRef<(sessionId: string) => void>(() => {})
  /**
   * 「现在显示的是哪个会话」。
   *
   * 异步回调（一个回合跑完 / 报错）**不能直接用 `current`** —— A 的回合结束时用户可能
   * 已经切到 B 去看别的了，那一份消息盖上去就把 B 的对话流冲掉了（§8.2 记忆隔离）。
   */
  /**
   * 不参与渲染、但要跨确认 / 暂停续跑的瞬时状态。
   *
   * 所有字段按 sessionId 分桶：A 会话多图拆分、上次模型都不能串到并行运行的 B。
   */
  const sessionRuntimeRef = useRef(new AgentSessionRuntimeState())
  const [queueMenuId, setQueueMenuId] = useState<string | null>(null)
  const [queueMenuPosition, setQueueMenuPosition] =
    useState<AgentQueueMenuPosition | null>(null)
  useEffect(() => {
    setQueueMenuId(null)
    setQueueMenuPosition(null)
  }, [current?.id])
  useEffect(() => {
    let alive = true
    void presets
      .loadAgentDeliveryMode()
      .then((mode) => {
        if (alive) setAgentDeliveryMode(mode)
      })
      .catch(() => {
        // 读取失败沿用内存默认“引导”，不打断 Agent 启动。
      })
    return () => {
      alive = false
    }
  }, [presets])
  useEffect(() => {
    if (!queueMenuId) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (
        target.closest(`[data-agent-queue-more="${queueMenuId}"]`) ||
        target.closest(`[data-agent-queue-menu="${queueMenuId}"]`)
      ) {
        return
      }
      setQueueMenuId(null)
      setQueueMenuPosition(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setQueueMenuId(null)
        setQueueMenuPosition(null)
      }
    }
    const closeOnViewportChange = () => {
      setQueueMenuId(null)
      setQueueMenuPosition(null)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    document.addEventListener('scroll', closeOnViewportChange, true)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnViewportChange)
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true)
      document.removeEventListener('scroll', closeOnViewportChange, true)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnViewportChange)
    }
  }, [queueMenuId])
  /** 订阅全量渠道：设置页改完立刻反映（与创作面板同一条口径） */
  const allChannels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const {
    modelRoute,
    routeExecution,
    cachedChatRoute,
    prepareChatRoute,
    commitChatRoute,
    clearChatRoute,
    clearChatRoutes,
  } = useAgentChatRouting({ channels, allChannels })
  /** 「已设默认」的提示框只闪一次，用完即收 */
  /** 展开看细节的步骤（工具调用 id 集合）。默认全收起 —— 对话流先保持干净 */
  /** 刚复制过哪一条助手回复：图标短暂换成对勾，给用户一个「确实复制了」的回执 */
  const [copiedKey, setCopiedKey] = useState<number | null>(null)
  /**
   * 当前展开的参数浮层（模型 / 技能 / 参数三选一）。
   *
   * 「开新关旧」由这一个 key 保证，与创作面板同一条口径 —— 各管各的 boolean
   * 会出现两个浮层同时挂在屏幕上、点哪个都不对。
   */
  const fileRef = useRef<HTMLInputElement | null>(null)
  /**
   * 中止用的控制器**按会话各存一个**（与 `statusBySession` 同一口径）。
   *
   * 早先只有一份 `abortRef`：在 B 里点发送会把 A 的那份覆盖掉，A 就再也停不下来；
   * 反过来「停止」也只停得到最后发出去的那一条。两个会话各跑各的，控制器也得各是各的。
   */
  const abortRefs = useRef(new Map<string, AbortController>())
  /**
   * AgentPanel 的持久写门禁只有这一份：
   * - 异步 SessionStore / Controller / preset / store 写必须走 trackRun；
   * - 同步 draft / composer 本地写必须走 runSync；
   * - 脱离点击等待链的 Promise 必须同时走 runTrackedDetached 或显式 catch。
   * 内部再嵌套一次 track 是允许的；关闭后内层会先失败并收口外层。
   */
  const runPromiseDetached = useCallback(
    (work: Promise<unknown>, failureMessage: string) => {
      void work.catch((error) => {
        if (error instanceof TaskLifecycleClosedError) return
        store.notify(`${failureMessage}：${errText(error)}`, 'error')
      })
    },
    [store],
  )
  const runTrackedDetached = useCallback(
    (work: () => Promise<unknown>, failureMessage: string) => {
      runPromiseDetached(trackRun(work), failureMessage)
    },
    [runPromiseDetached, trackRun],
  )
  const runSync = useCallback(
    <T,>(work: () => T) => lifecycle.runSync(work),
    [lifecycle],
  )
  const composerPanelRef = useRef<HTMLElement | null>(null)
  const patchSessionDetachedRef = useRef<
    (patch: AgentSessionPatch) => void
  >(() => {})
  const onComposerPendingAssetsChange = useCallback(
    (sessionId: string, pendingAssetIds: readonly string[]) => {
      if (currentIdRef.current !== sessionId) return
      patchSessionDetachedRef.current({
        pendingAssetIds: [...pendingAssetIds],
      })
    },
    [],
  )
  const composerDraftStorage = useMemo(() => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage
    } catch {
      return null
    }
  }, [])
  const composerController = useAgentComposerController({
    session: current,
    draftStorage: composerDraftStorage,
    pendingAssetIds: current?.pendingAssetIds ?? [],
    onPendingAssetsChange: onComposerPendingAssetsChange,
    panelRef: composerPanelRef,
    trackRunSync: runSync,
  })
  const {
    draft,
    setDraft,
    replaceDraft,
    openPicker,
    setOpenPicker,
    editorRef,
    composerRef,
    composerHeight,
    composerResizing,
    composerAvailableHeight,
    beginComposerResize,
    resizeComposerWithKeyboard,
    insertMention,
    cancelPendingAssetSync,
    writeDraftForSession,
    clearDraftForSession,
  } = composerController
  composerResetForSessionRef.current = composerController.resetForSession
  const {
    globalImageModels,
    globalVideoModels,
    modelOptionsByKind,
    chatModelOptions,
    mentionedModels,
    shownModel,
    defaultModelFor,
    logicalModelOf,
    selectedModelOf,
    fallbackModelOptionsForChannels,
    pickModel,
    setModelKind,
  } = useAgentModelSelectionController({
    current,
    draft,
    channels,
    allChannels,
    selection,
    getCanvasNodes: () => store.getSnapshot().nodes,
    patchSession: patchSessionFields,
    clearChatRoute,
    rememberStickyModel: (sessionId, kind, model) =>
      sessionRuntimeRef.current.rememberStickyModel(
        sessionId,
        kind,
        model,
      ),
  })
  /** 每个会话这个回合走的是原生 tools 还是 JSON 降级；确认后续跑要沿用同一条 */
  const toolModeRef = useRef(new Map<string, 'native' | 'json'>())
  const turnToolsRef = useRef(
    new Map<string, readonly ToolDeclaration[]>(),
  )
  const currentTurnIdRef = useRef(new Map<string, string>())
  const currentTurnJobIdRef = useRef(new Map<string, string>())
  const currentTurnRevisionRef = useRef(new Map<string, number>())
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
  const planAliasesRef = useRef(new Map<string, Map<string, string>>())
  const confirmRef = useRef<() => Promise<unknown>>(
    () => Promise.resolve(),
  )
  const {
    setAutoRun,
    autoRunFor,
    syncFromSession: syncAutoRunFromSession,
    clearAutoRuns,
  } = useAgentAutoRunController({
    current,
    statusFor: runPresentation.statusFor,
    patchSession: patchSessionFields,
    confirmLatest: () => confirmRef.current(),
    isCurrentSession: (sessionId) =>
      currentIdRef.current === sessionId,
  })
  /** 本轮正文里明确 @ 的图片 / 视频模型；只约束这一次用户回合。 */
  const explicitMediaModelsRef = useRef(
    new Map<string, { image?: string; video?: string }>(),
  )
  const deliveredSteersRef = useRef(new Map<string, Set<string>>())
  const contextTraceRef = useRef(
    new Map<string, AgentTurnContextTrace>(),
  )

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

  /**
   * 已启用渠道。`useMemo` 不是为了省那一次 filter，而是为了让**依赖它的
   * 回调**（选模型时要顺带定渠道）保持稳定 —— 不 memo 的话每次渲染都是新数组，
   * `useCallback` 的依赖永不相等，回调每帧重建。
   */
  const enabled = useMemo(() => channels.enabledChannels(), [channels, allChannels])
  const generationAvailability = useMemo(
    () => ({
      image: generationAvailabilityOf(allChannels, 'image', channels.protocolCatalog()),
      video: generationAvailabilityOf(allChannels, 'video', channels.protocolCatalog()),
    }),
    [allChannels, channels],
  )
  /** 技能列表：内置 + 我的。放在 `send` 之前 —— 它要在拼系统提示词时用到 */
  const allSkills = useMemo(
    () => [...skills.builtinSkills, ...skills.userSkills],
    [skills.builtinSkills, skills.userSkills],
  )
  /** 载入会话列表；没有就按默认模型建一个（设计文档 §8「新建会话用默认模型」） */
  useAgentInitialLoadController({
    projectId,
    trackRun,
    loadChannels: channels.load,
    liveChannels: () => channels.getState().channels,
    currentIdRef,
    selectionVersionRef,
    refresh,
    presets,
    setReviewModel: setAgentReviewModel,
    setCanvasReview: setAgentCanvasReview,
    getSession: sessions.get,
    createSession: sessions.create,
    fallbackModelOptions: fallbackModelOptionsForChannels,
    logicalModelOf,
    defaultModelFor,
    removeSession,
    setList,
    setCurrent,
    setMessages,
    notify: (message, tone) => store.notify(message, tone ?? 'error'),
    logWarning: (message, detail) => platform.logger.log('warn', message, detail),
  })

  const sessionActions = useAgentSessionActionsController({
    current,
    projectId,
    chatModelOptions,
    imageModelOptions: modelOptionsByKind.image,
    videoModelOptions: modelOptionsByKind.video,
    trackRun,
    createSession: sessions.create,
    loadAgentDefault: presets.loadAgentDefault,
    logicalModelOf,
    defaultModelFor,
    selectedModelOf,
    refresh,
    switchTo,
    setCurrent,
    clearInvalidCurrent: (sessionId) => {
      setList((previous) =>
        previous.filter((session) => session.id !== sessionId),
      )
      if (currentIdRef.current !== sessionId) return
      setCurrent(null)
      setMessages([])
    },
    renameSession,
    removeSession,
    clearDraftForSession,
    clearSessionRuntime: (sessionId) =>
      sessionRuntimeRef.current.clearSession(sessionId),
    isDeleteBlocked: (sessionId) =>
      isSessionActivityActive(sessionId) ||
      queuePumpingRef.current.has(sessionId) ||
      confirmingRef.current.has(sessionId),
    isCurrentSession: (sessionId) => currentIdRef.current === sessionId,
    describeError: errText,
    notify: store.notify,
  })
  sessionActionsResetRef.current = sessionActions.resetForSessionSwitch
  const {
    renaming,
    titleDraft,
    confirmDelete,
    setTitleDraft,
    cancelRename,
    startRename,
    commitRename,
    deleteSession,
    newSession,
  } = sessionActions

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

  const applySessionSnapshot = useCallback((next: AgentSession) => {
    if (next.messageRevision !== undefined) {
      currentTurnRevisionRef.current.set(
        next.id,
        next.messageRevision,
      )
    }
    applySessionLifecycleSnapshot(next)
  }, [applySessionLifecycleSnapshot])

  const graph = useGraph()
  const nodeTitles = useMemo(() => buildNodeTitles(graph), [graph.nodes])
  const items = useMemo(
    () =>
      buildConversationItems({
        messages,
        pendingSteers: current?.pendingSteers ?? [],
        nodeTitles,
      }),
    [current?.pendingSteers, messages, nodeTitles],
  )
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const conversationViewportRef = useRef<{
    clientHeight: number
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const {
    beginReveal,
    clearReveal,
    expanded,
    toggleStep,
    showJumpToLatest,
    setShowJumpToLatest,
    stickToLatestRef,
    onConversationScroll,
    jumpToLatest,
    resetForSessionSwitch,
    streamingTextIndex,
    visibleItems,
  } = useAgentConversationController({
    items,
    sessionId: current?.id ?? null,
    messages,
    status,
    taskPlan: current?.taskPlan,
    queuedCount: current?.queuedTurns.length ?? 0,
    pendingCount: current?.pendingSteers.length ?? 0,
    composerHeight,
    scrollRef,
    conversationViewportRef,
  })
  conversationResetForSessionRef.current = resetForSessionSwitch
  const setMessageReveal = useCallback(
    (reveal: AgentMessageReveal | null) => {
      if (reveal) {
        beginReveal(
          reveal.sessionId,
          reveal.fullText,
          reveal.visibleLength,
        )
      } else {
        clearReveal()
      }
    },
    [beginReveal, clearReveal],
  )

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
    turnOriginFor: (session, persistedTurn) => {
      const queueTurnId = activeQueueTurnOf(session.id)
      return {
        jobId:
          currentTurnJobIdRef.current.get(session.id) ??
          controller.jobId(session.id),
        turnId:
          queueTurnId ??
          currentTurnIdRef.current.get(session.id) ??
          controller.turnId(session.id),
        queueTurnId,
        messageRevision: persistedTurn?.messageRevision ??
          session.messageRevision ??
          currentTurnRevisionRef.current.get(session.id),
      }
    },
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
   * 把 `prepareAgentTurnRequest` 的静态入参接好；两个顺序回调由发送主体提供。
   *
   * 这一块留在宿主，是因为入参全是面板自己的数据接线（graph / selection /
   * memory / skills / channels …）；搬进 hook 只会把同样的依赖再抄一遍。
   */
  const prepareTurn = useCallback(
    ({ session, text, internalControl, signal, hooks }: AgentPrepareArgs) =>
      prepareAgentTurnRequest({
        session,
        text,
        internalControl,
        graph: store.getSnapshot(),
        selection,
        sessions,
        prepareRoute: () => prepareChatRoute(session, true),
        signal,
        memory,
        projectId: store.getSnapshot().projectId,
        readAssetMime: async (hash) =>
          (await platform.assets.read(hash).catch(() => null))?.mime ??
          null,
        notifyContextError: (message) =>
          store.notify(message, 'error'),
        skills: allSkills,
        channels: allChannels,
        canvasReviewEnabled,
        activeAgentTools,
        generationAvailability,
        routeExecution,
        notifyRecordWarning: (warning) =>
          store.notify(
            `结果已返回，但运行记录写入失败：${warning}`,
            'error',
          ),
        onPersisted: hooks.onPersisted,
        onRouteReady: hooks.onRouteReady,
      }),
    [
      activeAgentTools,
      allChannels,
      allSkills,
      canvasReviewEnabled,
      generationAvailability,
      memory,
      platform,
      prepareChatRoute,
      routeExecution,
      selection,
      sessions,
      store,
    ],
  )

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

  /** 复制一条助手回复；剪贴板被拒时静默 —— 不弹一个用户看不懂的错误 */
  const copyReply = useCallback(async (key: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500)
    } catch {
      /* 无权限 / 非安全上下文：静默 */
    }
  }, [])

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

  /**
   * 存会话上的任意字段：模型、技能、素材标签、比例 / 画质 / 质量都走这一条。
   *
   * `list` 必须**跟着一起改**：切走再切回时 `switchTo` 取的是 `list` 里的那一行，
   * 不同步的话「刚选好的模型 / 比例」会在切回时变回旧值 —— 而用户看到的是
   * 「选了下拉自己变回去」，只会当成功能坏了。更糟的是那份旧行会被下一次保存
   * 整份写回去，把库里的新值也冲掉。
   */
  const patchSession = useCallback(
    async (patch: AgentSessionPatch) => {
      if (!current) return
      await patchSessionFields(current.id, patch)
    },
    [current, patchSessionFields],
  )
  const patchSessionDetached = useCallback(
    (patch: Parameters<typeof patchSession>[0]) => {
      void patchSession(patch).catch((error) => {
        if (error instanceof TaskLifecycleClosedError) return
        store.notify(`保存会话设置失败：${errText(error)}`, 'error')
      })
    },
    [patchSession, store],
  )
  patchSessionDetachedRef.current = patchSessionDetached

  const {
    skillFavs,
    skillLabel,
    skillFileRef,
    skillDirRef,
    setSkill,
    importSkills,
    openSkillLibrary,
    toggleSkillFavorite,
  } = useAgentSkillsController({
    active,
    projectId,
    current,
    allSkills,
    setDraft,
    patchSession,
    setOpenPicker,
    skills,
    presets,
    notify: store.notify,
    trackRun,
  })

  /**
   * 在输入框里插入一个 @ 引用（引用菜单里选完之后调它）。
   *
   * 走编辑器自己的 `insertMention`，而不是往 `draft` 里拼字符串：
   * 引用要落在**光标处**、要带 chip 的存储形态，这两件事只有编辑器知道。
   */
  /** 节点在正文里显示成什么名字（没起名就写「素材」，不露 `node_xxx`） */
  const nodeLabelOf = useCallback(
    (id: string) => conversationNodeLabelOf(graph.nodes, id),
    [graph.nodes],
  )

  const latestUserStartedAt = latestUserStartedAtOf(visibleItems)
  const latestProcessIndex = latestProcessIndexOf(visibleItems)
  const currentTurnHasProcess = currentTurnHasProcessOf(visibleItems)
  /** 节点 id → 产物 hash：步骤卡据此把这一步产出的图**内嵌**显示（图变更时跟着刷） */
  const hashOfNode = useMemo(() => buildAssetHashByNode(graph), [graph])

  const {
    addFromLibrary,
    attachFiles,
    thumbOf,
    thumbVersion,
  } = useAgentAttachmentsController({
    active,
    projectId,
    current,
    draft,
    messages,
    nodeHashes: hashOfNode,
    platform,
    store,
    viewport,
    library,
    insertMention,
    nodeLabelOf,
    patchSession,
    patchSessionDetached,
    trackRun,
  })

  /**
   * 会话字段 → **正文 chip**（用户 2026-10-02：「我需要全部出现在正文里面，全部保持
   * 和艾特的出现的地方一样」）。
   *
   * 进一个会话时，把「这次挂着的素材」补成本文里的引用 chip：
   * 正文是**看得见的记录**（「这次用它」），会话行是**真正生效的设置**。
   *
   * 两条纪律：① 只在正文还空着的时候补（用户写了一半的那句话不能被冲掉）；
   * ② 每个会话只补一次（发完消息正文会清空，不能把刚发走的那几枚引用又倒回来）。
   *
   * ⚠️ **技能不补**（用户 2026-10-22：「每次打开 agent 都把我在技能库里点击
   * 使用的 skill 放在对话框里」）：技能是会话设置，只在用户主动从 Agent 技能
   * 菜单里选择时落成正文 chip；重新打开面板不能凭空生成一枚技能引用。
   *
   * ⚠️ **图片 / 视频模型不补**（用户 2026-10-05 第 1 条：「每次打开对话，对话框会有
   * 两个模型」）：那是**会话设置**（建生成节点时用哪一档），不是这句话要说出去的内容。
   * 补进正文的副作用是每开一次会话就凭空多两枚 `model` chip，看起来像用户自己写的；
   * 用户主动点模型时仍然会插 chip（那一次是「我这次要用它」），设置本身也照旧生效。
   */
  /**
   * 正文 chip → 会话字段（反向）：用户把主动插入的技能 chip 删掉 = **这次不用这个技能**。
   *
   * 不能再用「正文非空但没有技能 chip」来判断：进入会话时技能本来就不再自动
   * 写进正文，用户正常打字也会命中这个条件。这里只认一次真实删除 —— 同一个
   * 会话、同一个技能，上一拍正文里见过这枚 chip，下一拍它消失了。
   *
   * 发送之后正文会被清空，那一瞬间不该把设置也一并清光（技能是「本会话挂着的
   * 东西」，不是「这一条的附件」）。
   */
  const seenSkillChipRef = useRef<{
    sessionId: string
    skillId: string
    seen: boolean
  } | null>(null)
  useEffect(() => {
    if (!current?.skillId) {
      seenSkillChipRef.current = null
      return
    }
    const skillId = current.skillId
    const skillIds = parseMentions(draft)
      .filter((m) => m.kind === 'skill')
      .map((m) => m.id)
    const seen = skillIds.includes(skillId)
    const prev = seenSkillChipRef.current
    const removed =
      draft.trim() !== '' &&
      prev?.sessionId === current.id &&
      prev.skillId === skillId &&
      prev.seen &&
      !seen
    if (removed) {
      runPromiseDetached(setSkill(''), '清除技能设置失败')
    }
    seenSkillChipRef.current = { sessionId: current.id, skillId, seen }
  }, [
    draft,
    current?.id,
    current?.skillId,
    runPromiseDetached,
    setSkill,
  ])

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

  return (
    <AgentPanelView
      current={current}
      openPicker={openPicker}
      headerProps={{
        sessions: list,
        current,
        renaming,
        titleDraft,
        pickerOpen: openPicker === 'agent-session',
        confirmDelete,
        onTitleDraftChange: setTitleDraft,
        onCommitRename: () =>
          runPromiseDetached(commitRename(), '重命名失败'),
        onCancelRename: cancelRename,
        onToggleSessionPicker: () =>
          setOpenPicker(
            openPicker === 'agent-session' ? null : 'agent-session',
          ),
        onClosePicker: () => setOpenPicker(null),
        onSwitchSession: (session) => void switchTo(session),
        onNewSession: () =>
          runPromiseDetached(newSession(), '新建会话失败'),
        onStartRename: startRename,
        onDeleteSession: () =>
          runPromiseDetached(deleteSession(), '删除会话失败'),
        onOpenSettings,
        onClose,
      }}
      conversationProps={{
        current,
        status,
        items,
        visibleItems,
        latestProcessIndex,
        streamingTextIndex,
        liveActivities,
        liveProcess,
        runTasks,
        copiedKey,
        expanded,
        hashOfNode,
        thumbOf,
        currentTurnHasProcess,
        latestUserStartedAt,
        pendingPlan,
        pendingTaskStepId,
        advancingTaskPlan,
        scrollRef,
        showJumpToLatest,
        queueMenuId,
        queueMenuPosition,
        editingQueueId,
        editingQueueTurn,
        editingQueueText,
        onConversationScroll,
        onCopyReply: (key, text) => void copyReply(key, text),
        onRetry: retry,
        onToggleStep: toggleStep,
        onAdvanceToNext: () => {
          if (!current) return
          runPromiseDetached(
            advanceTaskPlan(current),
            '推进任务计划失败',
          )
        },
        onContinueTask: () =>
          runPromiseDetached(continueTask(), '继续任务失败'),
        onConfirm: () =>
          runPromiseDetached(confirm(), '确认执行失败'),
        onCancel: () =>
          runPromiseDetached(cancel(), '取消任务失败'),
        onJumpToLatest: jumpToLatest,
        onGuideQueuedTurn: (turn) =>
          runPromiseDetached(guideQueuedTurn(turn), '转为引导失败'),
        onRemoveQueued: (turnId) =>
          runPromiseDetached(removeQueued(turnId), '移出队列失败'),
        onQueueMenuIdChange: setQueueMenuId,
        onQueueMenuPositionChange: setQueueMenuPosition,
        onBeginQueueEdit: beginQueueEdit,
        onCommitQueueEdit: () =>
          runPromiseDetached(commitQueueEdit(), '保存队列编辑失败'),
        onEditingQueueIdChange: setEditingQueueId,
        onEditingQueueTextChange: setEditingQueueText,
        onResumeQueue: () =>
          runPromiseDetached(resumeQueue(), '恢复队列失败'),
      }}
      composerProps={{
        current,
        status,
        deliveryMode,
        draft,
        composerHeight,
        composerResizing,
        openPicker,
        shownModel,
        chatModelOptions,
        modelOptionsByKind,
        globalImageModels,
        globalVideoModels,
        mentionedModels,
        graph,
        libraryAssets,
        allSkills,
        skillLabel,
        skillFavs,
        skills,
        thumbVersion,
        editorRef,
        composerRef,
        fileRef,
        skillFileRef,
        skillDirRef,
        composerAvailableHeight,
        beginComposerResize,
        resizeComposerWithKeyboard,
        replaceDraft,
        send,
        stop: () => runPromiseDetached(stop(), '停止任务失败'),
        attachFiles: (files) =>
          runPromiseDetached(attachFiles(files), '添加素材失败'),
        addFromLibrary: (hash) =>
          runPromiseDetached(addFromLibrary(hash), '添加素材失败'),
        pickModel: (name) =>
          runPromiseDetached(pickModel(name), '保存模型设置失败'),
        setModelKind: (kind, value) =>
          runPromiseDetached(
            setModelKind(kind, value),
            '保存模型设置失败',
          ),
        setSkill: (id) =>
          runPromiseDetached(setSkill(id), '保存技能设置失败'),
        toggleSkillFavorite: (id) =>
          runPromiseDetached(
            toggleSkillFavorite(id),
            '保存技能收藏失败',
          ),
        openSkillLibrary,
        importSkills: (files) =>
          runPromiseDetached(importSkills(files), '导入技能失败'),
        patchSession: patchSessionDetached,
        setAutoRun: (value) =>
          runPromiseDetached(setAutoRun(value), '保存自动执行设置失败'),
        insertMention,
        setDraft,
        setOpenPicker,
        thumbOf,
        channels,
        library,
      }}
      onDismissPicker={() => setOpenPicker(null)}
      onDropFiles={(files) =>
        runPromiseDetached(attachFiles(files), '添加素材失败')}
    />
  )
}
