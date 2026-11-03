import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
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
import {
  confirmationRequiresExplicitApproval,
} from '../../../../domain/agent/confirmation'
import {
  advanceAgentTaskPlanAfterReview,
  agentTaskPlanProgress,
} from '../../../../domain/agent/taskPlan'
import { createPresetStore } from '../../../../state/project/presetStore'
import { assetNodeSize } from '../../../../domain/canvas/layout/assetNodeSize'
import {
  centeredNodeOrigin,
  findFreeRect,
} from '../../../../domain/agent/landing'
import type { AgentNodeType } from '../../../../domain/agent/plan'
import {
  channelIdForLogical,
  capabilityOfLogical,
  panelModelOptions,
  toLogicalName,
} from '../../../../domain/project/modelCatalog'
import {
  generationAvailabilityOf,
  runRouteCandidatesOf,
} from '../../../../domain/project/generationRouting'
import { resolveDefaults } from '../../../../features/canvas/createNodeWithDefaults'
import { cropAsset, extractSelection } from '../../../../features/canvas/extractSelection'
import { splitNodeToGrid } from '../../../../features/canvas/splitToGrid'
import { subscribeAgentHandoff, takeAgentHandoff } from '../../../../features/canvas/agentHandoff'
import {
  subscribeAgentSkillHandoff,
  takeAgentSkillHandoff,
} from '../../../../features/canvas/agentSkillHandoff'
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
  createAssetNode,
  importAssetFile,
  isImportableMedia,
  type ImportedAsset,
} from '../../../../features/canvas/importAsset'
import { createAssetLibraryRepository } from '../../../../state/project/assetLibraryRepository'
import { createAssetLibraryStore } from '../../../../state/project/assetLibraryStore'
import { createInspirationRepository } from '../../../../state/project/inspirationRepository'
import { loadInspirationSources } from '../../../../state/project/inspirationSourceStore'
import { runDesignResearch } from '../../../../features/shared/research/designResearchRunner'
import { parseSkillMarkdown } from '../../../../domain/prompt/skill'
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
import { createModelRoutePort } from '../../../../features/shared/agent/ModelRoutePort'
import { createRouteExecutionPort } from '../../../../features/shared/agent/RouteExecutionPort'
import {
  createAgentController,
  type AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
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
import { createId } from '../../../../shared/id'
import {
  sessionForQueuedTurn,
  type QueuedAgentTurn,
} from '../../../../domain/agent/queuedTurn'
import { createAgentPanelShutdownControl } from './agentPanelShutdown'
import { steerMessagesOf } from '../../../../domain/agent/steering'
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
import { toConversation } from './conversation'
import {
  preferredGeneratedModel,
} from './mediaMentions'
import { isAdvanceTaskCommand } from './agentProcessText'
import {
  useAgentConversationController,
  type AgentMessageReveal,
} from './useAgentConversationController'
import { useAgentComposerController } from './useAgentComposerController'
import { AgentSessionRuntimeState } from './agentSessionRuntime'
import {
  buildAgentModelMessages,
  composeAgentOutcomeMessages,
} from './agentTurnPersistence'
import {
  prepareAgentTurnRequest,
  type AgentTurnContextTrace,
} from './agentTurnRequest'
import { errText } from '../../agent/agentLoop'
import { loadAssetUrl } from '../../../../features/shared/assets/index'
import {
  IDLE_STATUS,
  statusCanSteer,
  statusIsBusy,
  type AgentPanelStatus as Status,
} from './AgentActivityViews'
import type { AgentQueueMenuPosition } from './AgentQueuePanel'
import { AgentConversationPane } from './AgentConversationPane'
import { AgentComposerPane } from './AgentComposerPane'
import { AgentPanelHeader } from './AgentPanelHeader'
import { useAgentQueueController } from './useAgentQueueController'
import { useAgentSendController } from './useAgentSendController'
import { useAgentOutcomeCoordinator } from './useAgentOutcomeCoordinator'
import { assembleAgentLoopDeps } from './agentLoopDeps'
import { continueAgentAutoConfirmations } from './agentAutoConfirmations'
import { runAgentConfirmation } from './agentConfirmationRun'
import { runAgentContinuation } from './agentContinuationRun'
import {
  settleAgentInterruption,
  type AgentInterruptionSettlementResult,
} from './agentInterruptSettlement'
import { runAgentCanvasNodes } from './agentCanvasRun'
import { useAgentRunPresentation } from './useAgentRunPresentation'
import {
  type AgentChatRoute,
  type ChatRoutePreparation,
} from './agentChatRoute'
import { previewOf } from './agentConfirmationPreview'
import { originOf, viewportWorldOf } from './agentPanelViewHelpers'
import {
  mentionToken,
  parseMentions,
  stripMentionMarkup,
} from '../../text/MentionEditor'
import styles from './AgentPanel.module.css'

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

  const [list, setList] = useState<AgentSession[]>([])
  const listRef = useRef<AgentSession[]>([])
  listRef.current = list
  const [current, setCurrent] = useState<AgentSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
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
  const currentIdRef = useRef<string | null>(null)
  /**
   * 不参与渲染、但要跨确认 / 暂停续跑的瞬时状态。
   *
   * 所有字段按 sessionId 分桶：A 会话多图拆分、上次模型都不能串到并行运行的 B。
   */
  const sessionRuntimeRef = useRef(new AgentSessionRuntimeState())
  currentIdRef.current = current?.id ?? null
  const [queueMenuId, setQueueMenuId] = useState<string | null>(null)
  const [queueMenuPosition, setQueueMenuPosition] =
    useState<AgentQueueMenuPosition | null>(null)
  useEffect(() => {
    setQueueMenuId(null)
    setQueueMenuPosition(null)
    setAdvancingTaskPlan(false)
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
  const customModels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().customModels,
    () => [],
  )
  const uncommonModelIds = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().uncommonModelIds,
    () => [],
  )
  const globalImageModels = useMemo(
    () => channels.globalModelsOf('image').map((model) => model.id),
    [channels, customModels, uncommonModelIds],
  )
  const globalVideoModels = useMemo(
    () => channels.globalModelsOf('video').map((model) => model.id),
    [channels, customModels, uncommonModelIds],
  )
  /** 会话改名：就地编辑，Enter 提交 / Esc 取消（不弹原生 prompt —— 那会打断画布操作） */
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  /** 删除会话走两步：第一次点只是「准备好」，第二次点才真删（对齐库里其他删除入口） */
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** 「已设默认」的提示框只闪一次，用完即收 */
  /** 展开看细节的步骤（工具调用 id 集合）。默认全收起 —— 对话流先保持干净 */
  /** 刚复制过哪一条助手回复：图标短暂换成对勾，给用户一个「确实复制了」的回执 */
  const [copiedKey, setCopiedKey] = useState<number | null>(null)
  const [advancingTaskPlan, setAdvancingTaskPlan] = useState(false)
  /**
   * 当前展开的参数浮层（模型 / 技能 / 参数三选一）。
   *
   * 「开新关旧」由这一个 key 保证，与创作面板同一条口径 —— 各管各的 boolean
   * 会出现两个浮层同时挂在屏幕上、点哪个都不对。
   */
  /** 技能收藏（用户 2026-10-03：技能菜单分「通用 / 收藏 / 我的」） */
  const [skillFavs, setSkillFavs] = useState<readonly string[]>([])
  const fileRef = useRef<HTMLInputElement | null>(null)
  /** 技能导入的两个输入：**.md 文件**与**文件夹**（浏览器只允许二选一，故分成两个） */
  const skillFileRef = useRef<HTMLInputElement | null>(null)
  const skillDirRef = useRef<HTMLInputElement | null>(null)
  /**
   * 中止用的控制器**按会话各存一个**（与 `statusBySession` 同一口径）。
   *
   * 早先只有一份 `abortRef`：在 B 里点发送会把 A 的那份覆盖掉，A 就再也停不下来；
   * 反过来「停止」也只停得到最后发出去的那一条。两个会话各跑各的，控制器也得各是各的。
   */
  const abortRefs = useRef(new Map<string, AbortController>())
  const lifecycleRef = useRef<TaskLifecycle | null>(null)
  if (!lifecycleRef.current) {
    lifecycleRef.current = createTaskLifecycle()
  }
  const lifecycle = lifecycleRef.current
  /**
   * AgentPanel 的持久写门禁只有这一份：
   * - 异步 SessionStore / Controller / preset / store 写必须走 trackRun；
   * - 同步 draft / composer 本地写必须走 runSync；
   * - 脱离点击等待链的 Promise 必须同时走 runTrackedDetached 或显式 catch。
   * 内部再嵌套一次 track 是允许的；关闭后内层会先失败并收口外层。
   */
  const trackRun = useCallback<TaskLifecycle['track']>(
    (work) => lifecycle.track(work),
    [lifecycle],
  )
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
  /** 自动生成是“实时开关”：用户在本轮运行中切换，已经发出的这一轮也要立刻认新值 */
  const autoRunRef = useRef(new Map<string, boolean>())
  /** 本轮正文里明确 @ 的图片 / 视频模型；只约束这一次用户回合。 */
  const explicitMediaModelsRef = useRef(
    new Map<string, { image?: string; video?: string }>(),
  )
  /**
   * 一次用户回合解析出的实际渠道。
   *
   * 确认与自动执行会把同一回合拆成多次模型调用，这些调用必须继续走同一条渠道；
   * 下一次真正发送新消息时再按全局策略重新选路。
   */
  const chatRouteRef = useRef(new Map<string, AgentChatRoute>())
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
        autoRunRef.current.clear()
        explicitMediaModelsRef.current.clear()
        chatRouteRef.current.clear()
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
    cancelPendingAssetSync,
    lifecycle,
    onDisposeReady,
    store,
  ])

  const modelRoute = useMemo(
    () =>
      createModelRoutePort((request) =>
        channels.planGenerationRoute(request),
      ),
    [channels],
  )
  const routeExecution = useMemo(
    () =>
      createRouteExecutionPort((request) => {
        const { onStream, ...rest } = request
        return channels.completeWithTools({
          ...rest,
          ...(onStream ? { onChunk: onStream } : {}),
        })
      }),
    [channels],
  )

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
  /**
   * 对话模型下拉的**数据源**：与创作面板同一套「前端显示名」（§7.4.1 / modelCatalog）。
   *
   * 为什么不用「渠道里勾选的原始 ID」：用户在面板上看到的是「GPT-6 Astra」
   * 「Agnes 2.5 Pro」这类显示名；这里要是一串 `agnes-2.5-pro`、`mock-chat-1`，
   * 同一个模型就变成两个名字，还得让用户记住哪个 ID 对应哪条渠道 —— 这不是选模型，
   * 是考古。`panelModelOptions` 本身就是「固定清单显示名在前 + 渠道勾选模型的
   * 归一显示名在后」，与生成节点那侧完全同源。
   */
  /**
   * 对话窗的模型清单：固定前端名，不按渠道当前是否可路由增删。
   * 没有真实对话渠道提供所选名称时，发送前的 `resolveRoutedChatTarget()`
   * 会立即返回空并给出明确错误，不会把请求发出去等超时。
   */
  const modelOptionsByKind = useMemo(() => {
    /**
     * 生成模型（图片 / 视频）：**前端有什么就列什么**。
     *
     * 用户 2026-10-02 第四轮：「图一当中模型的选择面板，把前端所有的模型写上去，
     * 除了对话模型」—— 这里与创作面板**同一份清单**（`panelModelOptions`：
     * 只有前端显示名，渠道模型不进这个列表，见对账 #371），
     * 不再按「当下有没有渠道能提供」筛一道。
     *
     * 为什么改回来：筛过之后，用户还没配映射的那些固定显示名会**整个消失**，
     * 面板看起来像「我的模型不见了」；而真正跑不动时执行层会报明确原因
     * （渠道 / 映射那句），比「列表里没有」好排查得多。对话模型不在这里 ——
     * 它是单独一行（agent 自己的 LLM）。
     */
    const pick = (category: 'image' | 'video') =>
      category === 'image' ? globalImageModels : globalVideoModels
    /** 对话模型也保持固定的前端清单，不按渠道能力增删。 */
    const chat = panelModelOptions('chat', uncommonModelIds)
    return { image: pick('image'), video: pick('video'), chat }
  }, [globalImageModels, globalVideoModels, uncommonModelIds])
  const chatModelOptions = modelOptionsByKind.chat
  /**
   * **已经放进这次对话的模型**（正文里的 `model` chip）。
   *
   * 用户 2026-10-04 第 3 条把图一那枚 ✓ 的含义说清楚了：「不是默认用这两个模型的
   * 意思，是把模型放在对话框中，意思是用这些模型进行生成，能组成多个模型参与的流程」。
   * 所以模型面板里的高亮要跟着**正文里的引用**走，而不是跟着会话的默认模型走 ——
   * 后者看起来就是「默认值」，正是用户否掉的那种读法。
   * （会话那两个默认字段仍然保留：用户一枚都没 @ 时，新节点还得有个可用的模型。）
   */
  const mentionedModels = useMemo(
    () => new Set(parseMentions(draft).filter((m) => m.kind === 'model').map((m) => m.id)),
    [draft],
  )
  /** 会话存的模型名 → 逻辑显示名（老会话存过上游 ID 的在这里归一） */
  const shownModel = useMemo(
    () => toLogicalName(allChannels, current?.model ?? ''),
    [allChannels, current?.model],
  )
  /**
   * 取本轮路由：同一会话、同一逻辑模型在本轮内复用；换模型或开始新消息时重新选。
   * UI 只保存逻辑名，渠道始终是后台实现细节。
   */
  const cachedChatRoute = useCallback((session: AgentSession): AgentChatRoute | null => {
    const logicalModel =
      toLogicalName(allChannels, session.model) || session.model.trim()
    const cached = chatRouteRef.current.get(session.id)
    return cached?.logicalModel === logicalModel ? cached : null
  }, [allChannels])

  const prepareChatRoute = useCallback(
    async (
      session: AgentSession,
      fresh = false,
    ): Promise<ChatRoutePreparation> => {
      const logicalModel =
        toLogicalName(allChannels, session.model) || session.model.trim()
      if (!logicalModel) {
        return { ok: false, message: '还没选模型：先在上面选一个对话模型' }
      }
      const cached = cachedChatRoute(session)
      if (!fresh && cached) return { ok: true, route: cached }
      const planned = await modelRoute.plan({
        capability: 'chat',
        logicalModel,
      })
      if (!planned.ok) {
        const message =
          planned.reason === 'no_token'
            ? `「${logicalModel}」的 Key 还未配置`
            : planned.reason === 'policy_excluded'
              ? `「${logicalModel}」已被当前路由范围排除`
              : `没有可用的模型服务提供「${logicalModel}」：请在模型服务里勾选该模型或补好模型映射`
        return { ok: false, message }
      }
      const candidates = runRouteCandidatesOf(planned.plan)
      const first = candidates[0]
      if (!first) {
        return {
          ok: false,
          message: `没有可用的模型服务提供「${logicalModel}」`,
        }
      }
      const route: AgentChatRoute = {
        channelId: first.channelId,
        ...(first.credentialGroupId
          ? { credentialGroupId: first.credentialGroupId }
          : {}),
        logicalModel,
        upstreamModel: first.model,
        routePlanId: `${planned.plan.logicalModel}:${planned.plan.capability}:${planned.plan.strategy}`,
        candidates,
      }
      chatRouteRef.current.set(session.id, route)
      return { ok: true, route }
    },
    [allChannels, cachedChatRoute, modelRoute],
  )

  /**
   * 技能 chip 的文案：只进 `aria-label`（悬停 / 读屏可见）。
   *
   * 工具条上那两枚按用户 2026-10-02 的要求是**只有图标**的按钮，
   * 名字不占地方，但无障碍名不能跟着省。
   */
  const skillLabel = useMemo(() => {
    const id = current?.skillId
    if (!id) return '技能'
    return allSkills.find((s) => s.id === id)?.name ?? '技能'
  }, [current?.skillId, allSkills])

  useEffect(() => {
    if (!active) return
    const consumePendingSkill = () => {
      if (!current) return
      const skillId = takeAgentSkillHandoff(projectId)
      if (!skillId) return
      const skill = allSkills.find((item) => item.id === skillId)
      if (!skill) return
      setDraft((previous) => {
        const already = parseMentions(previous).some(
          (mention) => mention.kind === 'skill' && mention.id === skill.id,
        )
        if (already) return previous
        const marker = mentionToken('skill', skill.id, skill.name)
        return previous.trim() ? `${previous.replace(/\s+$/, '')} ${marker} ` : `${marker} `
      })
    }
    consumePendingSkill()
    return subscribeAgentSkillHandoff(projectId, () => consumePendingSkill())
  }, [active, allSkills, current, projectId])

  /**
   * 新会话该用哪个模型：默认模型 → 该渠道第一个对话模型。
   *
   * **必须有这层回落**：只存了「默认模型」而没选过时，新会话会带着空模型开出来，
   * 用户第一句话就被「还没选模型」挡住 —— 开箱即不能用。冒烟 G95 抓到过这一条。
   *
   * 存的是**逻辑显示名**：发请求前由渠道映射翻译成上游 ID（channelStore 已接）。
   * 显示名不在选项里（渠道模型被删 / 名单变了）才退到第一个选项。
   */
  const defaultModelFor = useCallback(
    (options: readonly string[], saved?: string) =>
      saved && options.includes(saved) ? saved : (options[0] ?? ''),
    [],
  )

  /** 载入会话列表；没有就按默认模型建一个（设计文档 §8「新建会话用默认模型」） */
  const refresh = useCallback(
    () =>
      trackRun(async () => {
        const rows = await controller.refresh()
        setList(rows)
        return rows
      }),
    [controller, trackRun],
  )

  useEffect(() => {
    let alive = true
    void trackRun(async () => {
      /**
       * 渠道 store 是应用级单例、挂载时统一 load；但**新建画布页**这条路径
       * 可能先于 load 完成就读 enabledChannels —— 那一刻 enabled 为空，
       * 新会话会带着空渠道开出来，第一句话就报「还没选模型」。
       * 这里补一次 await load（幂等），把时序缝上。
       */
      await channels.load()
      const rows = await refresh()
      const savedReviewModel = await presets.loadAgentReviewModel()
      const savedCanvasReview = await presets.loadAgentCanvasReview()
      if (!alive) return
      setAgentReviewModel(savedReviewModel ?? '')
      setAgentCanvasReview(savedCanvasReview)
      if (rows.length > 0) {
        const head = rows[0]!
        const loaded = (await sessions.get(head.id).catch(() => null)) ?? head
        setCurrent(loaded)
        setMessages(loaded.messages)
        return
      }
      /**
       * 用**刚刚读到的**渠道，而不是本次渲染闭包里的 `enabled`：effect 只在
       * projectId 变化时跑，那个 `enabled` 可能是挂载那一帧的快照 ——
       * 渠道还没 load 完时它就是空的，新会话会带着空模型开出来。
       */
      const liveChannels = channels.getState().channels
      const liveEnabled = liveChannels.filter((c) => c.enabled)
      const livePick = (category: 'image' | 'video' | 'chat') =>
        panelModelOptions(category).filter(
          (n) => channelIdForLogical(liveEnabled, n) !== undefined,
        )
      const liveModelOptions = panelModelOptions('chat')
      const saved = await presets.loadAgentDefault()
      const savedModel = toLogicalName(liveChannels, saved?.model ?? '')
      const created = await sessions.create({
        projectId,
        channelId: '',
        model: defaultModelFor(liveModelOptions, savedModel),
        imageModel: livePick('image')[0] ?? '',
        videoModel: livePick('video')[0] ?? '',
      })
      if (!alive) return
      setList([created])
      setCurrent(created)
      setMessages([])
    }).catch((error) => {
      if (
        alive &&
        !(error instanceof TaskLifecycleClosedError)
      ) {
        store.notify(`Agent 会话读取失败：${errText(error)}`, 'error')
      }
    })
    return () => {
      alive = false
    }
    // 依赖只列 projectId：这里做的是「项目换了就重建会话列表」，
    // 把 refresh / sessions 列进来会让它在每次保存后重跑，把正在进行的对话打断
  }, [projectId, trackRun])

  const switchTo = useCallback(
    async (session: AgentSession) => {
      const loaded = (await sessions.get(session.id).catch(() => null)) ?? session
      setCurrent(loaded)
      // 记忆隔离：切会话就是**换一整套上下文**，不是接着上一个聊（§8.2）
      setMessages(loaded.messages)
      resetForSessionSwitch()
      /** 不再重置 status：每个会话有自己的运行态，切过去看到的是**它自己**那一份 */
      setDraft('')
      // 换了会话，之前「准备好删了」的那个状态不该跟过来
      setRenaming(false)
      setConfirmDelete(false)
    },
    [],
  )

  /**
   * **agent 建节点时「跟随选中」**（用户 2026-10-16：「改成跟随选中」）。
   *
   * 先在画布上选中一张香蕉 2 的图、再说「照这个再出五张」，agent 就该用香蕉 2 ——
   * 而不是 Agent 面板里那个「模型清单第一个」的默认值。真机上就是这一步错成
   * GPT Image 2.5 的（用户看到的是「它给我建的工作流模型不对」）。
   *
   * 按类别取：选中视频节点时不要把它当图片模型用（图片的 `mode` + 视频的 `model`
   * 这种组合发出去只会得到一句看不懂的报错）。
   */
  const selectedModelOf = useCallback(
    (kind: 'image' | 'video'): string => {
      for (const id of selection) {
        const n = store.getSnapshot().nodes.find((x) => x.id === id)
        if (!n) continue
        const d = n.data as { model?: unknown }
        const m = typeof d.model === 'string' ? d.model.trim() : ''
        if (!m) continue
        const category = capabilityOfLogical(allChannels, m)?.category
        if (kind === 'video' ? category === 'video' : category !== 'video') return m
      }
      return ''
    },
    [selection, store, allChannels],
  )

  const toolCtx = useCallback(
    (
      origin: { x: number; y: number },
      session: AgentSession | undefined = current ?? undefined,
    ): AgentToolContext => {
      const sessionId = session?.id ?? ''
      return {
        store,
        viewportWorld: viewportWorldOf(viewport),
        memoryContext: {
          workbench: 'canvas',
          projectId: store.getSnapshot().projectId,
          ...(sessionId ? { sessionId } : {}),
        },
        ...(sessionId
          ? {
              taskPlan: {
                get: async () => (await sessions.get(sessionId))?.taskPlan,
                save: (plan) =>
                  trackRun(async () => {
                    const next = await sessions.updateFields(sessionId, {
                      taskPlan: plan,
                    })
                    if (next) {
                      setList((prev) =>
                        prev.map((item) => (item.id === next.id ? next : item)),
                      )
                      if (currentIdRef.current === next.id) setCurrent(next)
                    }
                    return next?.taskPlan ?? null
                  }),
              },
            }
          : {}),
        origin,
        selectedIds: () => selection,
        selectedModelOf,
        ...(abortRefs.current.get(sessionId)?.signal
          ? { signal: abortRefs.current.get(sessionId)!.signal }
          : {}),
        /**
         * 用 ref 而不是闭包变量：这个回调在发消息那一刻创建、在用户点「批准」时才真正执行
         * （中间隔着一次确认），ref 读的是**最新一次发消息**算出来的判断。
         */
        ...(sessionRuntimeRef.current.isPerImage(sessionId)
          ? { perImage: true }
          : {}),
      resolveNodeIds: (ids) => {
        const aliases = planAliasesRef.current.get(sessionId)
        return ids.map((id) => aliases?.get(id) ?? id)
      },
      runNodes: (ids, signal) =>
        runAgentCanvasNodes(
          {
            store,
            execution,
            channels,
            platform,
            contextAssets: (
              contextTraceRef.current.get(sessionId)?.assetRefs ?? []
            ).filter((asset) => asset.mime.startsWith('image/')),
            setRunTasksFor,
          },
          {
            sessionId,
            nodeIds: ids,
            ...(signal ? { signal } : {}),
          },
        ),
      /**
       * agent 建的节点要和手建的节点使用同一套默认值。
       */
      defaultsForNewNode: async (types) => {
        const out: Partial<Record<AgentNodeType, Record<string, unknown>>> = {}
        for (const type of types) out[type] = await resolveDefaults({ channels, type })
        return out
      },
      /**
       * 生成节点用哪个模型：按计划里那个节点的 `data.mode` 选图片档还是视频档。
       *
       * 渠道由模型名**反查**（`channelIdForLogical`）—— 换了模型就得跟着换渠道，
       * 否则会发出「A 渠道 + B 渠道的模型」这种请求，报错还看不懂。
       */
      recipeForGenerated: (type, node) => {
        if (type !== 'generation') return undefined
        const kind = node.data.mode === 'video' ? 'video' : 'image'
        /**
         * ⚠️ **渠道必须跟着「最终那个模型」走**。
         *
         * 用户 2026-10-03 报：「我选了模型，它就该用那个模型」——但 agent 建的节点
         * 落成了 `model: "Agnes Video 2.0"` + `channelId: Comfy-gpt`，请求被中转站
         * 转发到 Agnes，回的是 Agnes 的「预扣费不足」，画布上什么都拿不到。
         *
         * 根因就在这一行：原来只看**面板里选的那一档**（那次是空的，于是拿默认配方
         * 的渠道），而**计划里模型自己写了 model** —— 计划数据在 `buildLandingCommand`
         * 里最后压上去，于是「模型是计划的、渠道是默认的」，两半拼出一个不存在的组合。
         *
         * 现在：计划里写了模型就以它为准去**反查渠道**；没写才用面板里选的那一档。
         */
        const planned = typeof node.data.model === 'string' ? node.data.model.trim() : ''
        /**
         * 优先级（用户 2026-10-16 定的口径）：
         *   ① 本轮正文里的模型 chip —— 明确选择最高优先；
         *   ② 计划自己写的模型；
         *   ③ 本会话当前图片 / 视频模型；
         *   ④ 本会话上次用过的那个模型 —— 连续迭代时沿用；
         *   ⑤ 画布上选中的节点模型 —— 会话还没有历史时的起点；
         *   ⑥ `undefined` —— 保持渠道默认配方不动。
         *
         * ④ 在 ⑤ 之上是有意的：同一段对话里用户已经交代过一次模型，后面没说就是「还用那个」，
         * 不该因为中途点选了别的节点而自己换掉。③ 又高于 ④，用户当轮改了会话模型时要立刻生效。
         */
        const explicit = explicitMediaModelsRef.current.get(sessionId)?.[kind]
        const sessionPicked =
          kind === 'video' ? session?.videoModel : session?.imageModel
        const stored = sessionRuntimeRef.current.stickyModelsFor(sessionId)[kind]
        const model = preferredGeneratedModel({
          explicit,
          planned,
          sessionPicked,
          sticky: stored,
          selected: selectedModelOf(kind),
        })
        if (!model) return undefined
        const channelId = channelIdForLogical(enabled, model, session?.channelId)
        if (!channelId) return undefined
        /**
         * 这次真正用上的模型记下来：ref 管本轮下一轮立刻生效，落库那份管重开还在。
         * 只在**真的变了**时才写，免得每建一次节点就落一次库。
         */
        if (model !== stored) {
          sessionRuntimeRef.current.rememberStickyModel(sessionId, kind, model)
          if (session) {
            runTrackedDetached(
              () =>
                sessions.updateFields(
                  session.id,
                  kind === 'video'
                    ? { videoModel: model }
                    : { imageModel: model },
                ),
              '保存生成模型失败',
            )
          }
        }
        return { channelId, model }
      },
      explicitRecipeForGenerated: (type, node) => {
        if (type !== 'generation') return undefined
        const kind = node.data.mode === 'video' ? 'video' : 'image'
        const model = explicitMediaModelsRef.current.get(sessionId)?.[kind]
        if (!model) return undefined
        const channelId = channelIdForLogical(enabled, model, session?.channelId)
        return { channelId: channelId ?? '', model }
      },
      contextAssetsForGenerated: (type) => {
        if (type !== 'generation') return undefined
        const assets = contextTraceRef.current.get(sessionId)?.assetRefs ?? []
        return assets.filter((asset) => asset.mime.startsWith('image/'))
      },
      channelIdForModel: (model) => channelIdForLogical(enabled, model),
      /**
       * 模型名 → 类别：给 `applyPlan` 纠正 `mode` 用（见 `alignGenerationMode`）。
       *
       * 真模型会把视频节点写成 `mode:"image"`，只写对 `model`；执行层按 `mode` 分链，
       * 不纠正就是「点了生成一个请求都不发」。
       */
      categoryOfModel: (model) => {
        const category = capabilityOfLogical(allChannels, model)?.category
        return category === 'audio' || category === 'unknown' ? undefined : category
      },
      sliceImage: (nodeId, mode, rect, ratio) => {
        const run = mode === 'crop' ? cropAsset : extractSelection
        return run({ platform, store }, { nodeId, rect, ...(ratio ? { ratio } : {}) })
      },
      splitGrid: (nodeId, rows, cols) =>
        splitNodeToGrid({ platform, store }, { nodeId, rows, cols }),
      rememberMemory: async (candidate) => {
        try {
          const saved = await memory.remember(candidate)
          return {
            ok: true,
            memoryId: saved.id,
            text: saved.text,
          }
        } catch (error) {
          return {
            ok: false,
            reason: error instanceof Error ? error.message : errText(error),
          }
        }
      },
      researchDesign: async (input) => {
        const [cachedSources, configuredSources] = await Promise.all([
          inspirationRepository.readAll().catch(() => []),
          loadInspirationSources(platform.storage).catch(() => []),
        ])
        const enabledIds = new Set(
          configuredSources.filter((source) => source.enabled).map((source) => source.id),
        )
        const libraryCases = cachedSources
          .filter((source) => enabledIds.has(source.sourceId))
          .flatMap((source) => source.cases)
        return runDesignResearch(
          input,
          {
            network: platform.network,
            libraryCases,
          },
          abortRefs.current.get(sessionId)?.signal ?? new AbortController().signal,
        )
      },
      }
    },
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
    ],
  )

  /**
   * 确认型工具只执行一次。
   *
   * 工具结果写在同一 Job 的不可变事件流水里，应用崩溃或确认按钮被再次触发时：
   * - 已完成：直接回放上次结果；
   * - 已开始未完成：转 needs_attention，不自动重发；
   * - 相同 callId 却换了参数：按失败处理，避免把两次不同操作混成一次。
   */
  const executeToolWithLedger = useCallback(
    async (
      sessionId: string,
      request: AgentToolRequest,
      execute: () => Promise<unknown>,
    ): Promise<unknown> => {
      const jobId =
        controller.jobId(sessionId) ??
        (await jobs.active(sessionId))?.id
      if (!jobId) {
        return execute()
      }
      const latest = await sessions.get(sessionId)
      const stepId = latest?.taskPlan?.currentStepId ?? 'unplanned'
      const outcome = await toolEffects.run({
        jobId,
        stepId,
        toolCallId: request.callId,
        toolName: request.name,
        args: request.args,
        execute,
      })
      if (outcome.kind === 'completed') {
        if (outcome.replayed) {
          store.notify('已复用这次工具调用的持久结果，没有重复执行或扣费', 'info')
        }
        return outcome.result
      }
      if (outcome.kind === 'pending') {
        throw new AgentToolEffectBlockedError(
          outcome.reason,
          'needs_attention',
          outcome,
        )
      }
      throw new AgentToolEffectBlockedError(
        outcome.kind === 'conflict' ? outcome.reason : outcome.error,
        'failed',
        outcome,
      )
    },
    [controller, jobs, sessions, store, toolEffects],
  )

  const executeConfirmedToolWithLedger = useCallback(
    (session: AgentSession, request: AgentToolRequest): Promise<unknown> =>
      executeToolWithLedger(session.id, request, () =>
        executeConfirmedTool(
          request.name,
          request.args,
          toolCtx(originOf(viewport), session),
        ),
      ),
    [executeToolWithLedger, toolCtx, viewport],
  )

  /**
   * AgentLoop 依赖的装配入口。
   *
   * 纯组装在 `agentLoopDeps.ts`；这里只把 store / channels / 会话 / Job / 工具执行器
   * 和 per-session refs 接成端口。回合创建时的 controller 必须由调用方显式传入。
   */
  const loopDeps = useCallback(
    (args: {
      session: AgentSession
      operationId: string
      toolMode?: 'native' | 'json'
      visualNodeIds?: readonly string[]
      onProgress?: (messages: readonly ChatMessage[]) => void
      turnTools?: readonly ToolDeclaration[]
      turnController?: AbortController
    }): AgentLoopDeps => {
      const { session } = args
      return assembleAgentLoopDeps(
        {
          store,
          channels,
          platform: { storage: platform.storage, assets: platform.assets },
          modelRoute,
          routeExecution,
          sessions,
          jobs,
          reviewModel,
          canvasReviewEnabled,
          viewport,
          executeToolWithLedger,
          toolCtx,
          nodeRunStates: () => execution.nodeStates,
          abortSignalFor: (sessionId) =>
            abortRefs.current.get(sessionId)?.signal,
          cachedChatRoute,
          updateChatRoute: (sessionId, route) => {
            chatRouteRef.current.set(sessionId, route)
          },
          contextTraceFor: (sessionId) =>
            contextTraceRef.current.get(sessionId),
          planAliasesFor: (sessionId) =>
            planAliasesRef.current.get(sessionId),
          setPlanAliases: (sessionId, aliases) => {
            planAliasesRef.current.set(sessionId, aliases)
          },
          turnToolsFor: (sessionId) =>
            turnToolsRef.current.get(sessionId),
          setTurnTools: (sessionId, tools) => {
            turnToolsRef.current.set(sessionId, tools)
          },
          deliveredSteersFor: (sessionId) =>
            deliveredSteersRef.current.get(sessionId) ?? new Set<string>(),
          setDeliveredSteers: (sessionId, ids) => {
            deliveredSteersRef.current.set(sessionId, ids)
          },
          appendLiveProcessFor,
          setLiveActivityFor,
          setStatusFor,
        },
        {
          session,
          operationId: args.operationId,
          toolMode: args.toolMode ?? 'native',
          visualNodeIds: args.visualNodeIds ?? [],
          onProgress: args.onProgress,
          turnTools: args.turnTools ?? activeAgentTools,
          turnController: args.turnController,
          abortSignalFor: (sessionId) =>
            abortRefs.current.get(sessionId)?.signal,
        },
      )
    },
    [
      channels,
      cachedChatRoute,
      modelRoute,
      reviewModel,
      canvasReviewEnabled,
      activeAgentTools,
      viewport,
      toolCtx,
      store,
      platform,
      sessions,
      jobs,
      execution,
      executeToolWithLedger,
      routeExecution,
      appendLiveProcessFor,
      setLiveActivityFor,
      setStatusFor,
    ],
  )

  const applySessionSnapshot = useCallback((next: AgentSession) => {
    if (next.messageRevision !== undefined) {
      currentTurnRevisionRef.current.set(
        next.id,
        next.messageRevision,
      )
    }
    setList((prev) => prev.map((item) => (item.id === next.id ? next : item)))
    if (currentIdRef.current === next.id) setCurrent(next)
  }, [])

  const graph = useGraph()
  const nodeTitles = useMemo(
    () =>
      new Map(
        graph.nodes.map((node) => [
          node.id,
          node.title?.trim() || '未命名节点',
        ]),
      ),
    [graph.nodes],
  )
  const items = useMemo(
    () =>
      toConversation(
        [
          ...messages,
          ...steerMessagesOf(
            current?.pendingSteers ?? [],
            stripMentionMarkup,
          ),
        ],
        nodeTitles,
      ),
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
      autoRun: () => autoRunRef.current.get(session.id) === true,
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

  const runSendText = useCallback(async (
    text: string,
    session: AgentSession,
    turnId?: string,
    internalControl = false,
    actualTurnId = createId('turnmsg'),
    turnAbort = new AbortController(),
  ) => {
    const turnOrigin: AgentTurnOrigin = {
      turnId: actualTurnId,
      queueTurnId: turnId,
    }
    currentTurnJobIdRef.current.delete(session.id)
    if (
      session.taskPlan &&
      agentTaskPlanProgress(session.taskPlan).status !== 'active'
    ) {
      const cleared = await trackRun(() =>
        sessions.updateFields(session.id, {
          taskPlan: undefined,
        }),
      )
      if (cleared) {
        setList((prev) =>
          prev.map((item) => (item.id === cleared.id ? cleared : item)),
        )
        if (currentIdRef.current === cleared.id) setCurrent(cleared)
      }
    }

    let routeReady = false
    const failBeforeModel = async (message: string, phase: string) => {
      await controller.failTurn(session.id, {
        reason: message,
        phase,
        aborted: turnAbort.signal.aborted,
        origin: turnOrigin,
      })
      clearLiveActivitiesFor(session.id)
      clearLiveProcessFor(session.id)
      clearRunTasksFor(session.id)
      setStatusFor(
        session.id,
        turnAbort.signal.aborted
          ? IDLE_STATUS
          : { kind: 'error', message },
      )
    }
    let requestPreparation: Awaited<
      ReturnType<typeof prepareAgentTurnRequest>
    >
    try {
      requestPreparation = await prepareAgentTurnRequest({
        session,
        text,
        internalControl,
        graph: store.getSnapshot(),
        selection,
        sessions,
        prepareRoute: () => prepareChatRoute(session, true),
        signal: turnAbort.signal,
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
        onPersisted: (turn) => {
          const saved = turn.saved
          if (
            !bindTurnToSessionActivity(
              saved.id,
              actualTurnId,
            )
          ) {
            throw new Error('会话活动锁已被其他回合占用')
          }
          turnOrigin.messageRevision = turn.messageRevision
          currentTurnIdRef.current.set(session.id, actualTurnId)
          currentTurnRevisionRef.current.set(
            session.id,
            turn.messageRevision,
          )
          setList((prev) =>
            prev.map((item) => (item.id === saved.id ? saved : item)),
          )
          if (currentIdRef.current === saved.id) {
            setCurrent(saved)
            setDraft('')
            writeDraftForSession(session.id, '')
            setMessages(turn.historyMessages)
          }
          clearLiveActivitiesFor(session.id)
          clearLiveProcessFor(session.id)
          clearRunTasksFor(session.id)
          abortRefs.current.set(session.id, turnAbort)
          setStatusFor(session.id, { kind: 'thinking' })
          autoRunRef.current.set(session.id, session.autoRun === true)
        },
        onRouteReady: async (operationId) => {
          routeReady = true
          const job = await ensureAgentJob(session, actualTurnId)
          currentTurnJobIdRef.current.set(session.id, job.id)
          turnOrigin.jobId = job.id
          await transitionSessionJob(
            session.id,
            'planning',
            'status_changed',
            { operationId },
            undefined,
            turnOrigin,
          )
        },
      })
    } catch (error) {
      if (routeReady) throw error
      if (turnAbort.signal.aborted) return
      setStatusFor(session.id, {
        kind: 'error',
        message: `用户消息或路由准备失败：${errText(error)}`,
      })
      return
    }
    if (requestPreparation.kind === 'aborted_before_job') return
    if (requestPreparation.kind === 'route_failed') {
      setStatusFor(session.id, {
        kind: 'error',
        message: requestPreparation.message,
      })
      return
    }
    if (requestPreparation.kind === 'failed') {
      if (requestPreparation.contextTrace) {
        contextTraceRef.current.set(
          session.id,
          requestPreparation.contextTrace,
        )
      } else {
        contextTraceRef.current.delete(session.id)
      }
      await failBeforeModel(
        requestPreparation.message,
        requestPreparation.phase,
      )
      return
    }

    const prepared = requestPreparation
    const persistedUserTurn = prepared.persistedTurn
    const operationId = prepared.operationId
    const toolMode = prepared.toolMode
    const turnAgentTools = prepared.turnTools
    if (prepared.contextTrace) {
      contextTraceRef.current.set(session.id, prepared.contextTrace)
    } else {
      contextTraceRef.current.delete(session.id)
    }
    toolModeRef.current.set(session.id, toolMode)
    explicitMediaModelsRef.current.set(
      session.id,
      prepared.explicitMediaModels,
    )
    sessionRuntimeRef.current.setPerImage(session.id, prepared.perImage)
    turnToolsRef.current.set(session.id, turnAgentTools)
    if (prepared.clearedPendingAssets) {
      const cleared = prepared.clearedPendingAssets
      setList((prev) =>
        prev.map((item) => (item.id === cleared.id ? cleared : item)),
      )
      if (currentIdRef.current === cleared.id) setCurrent(cleared)
    }
    const withFullHistory = (list: readonly ChatMessage[]): ChatMessage[] =>
      composeAgentOutcomeMessages(persistedUserTurn, list)
    const withSystem = buildAgentModelMessages(
      prepared.systemPrompt,
      persistedUserTurn,
    )
    const currentLoopDeps = loopDeps({
      session,
      operationId,
      toolMode,
      visualNodeIds: prepared.visualNodeIds,
      onProgress: (next) => {
        if (currentIdRef.current !== session.id) return
        clearReveal()
        setMessages(withFullHistory(next))
      },
      turnTools: turnAgentTools,
      turnController: turnAbort,
    })
    const initial = await runAgentTurn(withSystem, currentLoopDeps)
    const outcome = await continueAutoConfirmations(
      session,
      initial,
      currentLoopDeps,
      (next) => {
        if (currentIdRef.current === session.id) {
          setMessages(withFullHistory(next))
        }
      },
    )
    await handleOutcome(session, outcome, persistedUserTurn, turnAbort)
    return outcome
  }, [
    store,
    platform,
    allChannels,
    selection,
    loopDeps,
    handleOutcome,
    setStatusFor,
    allSkills,
    toolCtx,
    canvasReviewEnabled,
    activeAgentTools,
    viewport,
    routeExecution,
    prepareChatRoute,
    sessions,
    memory,
    generationAvailability,
    ensureAgentJob,
    transitionSessionJob,
    continueAutoConfirmations,
    controller,
  ])

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
   * 必须先 abort，再清持久化确认卡：否则迟到的 handleOutcome 可能在停止后
   * 又把 pendingConfirmation 写回来。这里只结束当前任务，不续跑模型。
   */
  const settleInterruptedSession = useCallback(
    async (
      session: AgentSession,
      request: AgentToolRequest | undefined,
      result: 'canceled' | 'interrupted',
    ): Promise<AgentInterruptionSettlementResult> => {
      const queueTurnId = activeQueueTurnOf(session.id)
      const turnOrigin: AgentTurnOrigin = {
        jobId:
          currentTurnJobIdRef.current.get(session.id) ??
          controller.jobId(session.id),
        turnId: queueTurnId ??
          currentTurnIdRef.current.get(session.id) ??
          controller.turnId(session.id),
        queueTurnId,
        messageRevision:
          session.messageRevision ??
          currentTurnRevisionRef.current.get(session.id),
      }
      const settlement = await settleAgentInterruption({
        session,
        request,
        result,
        turnOrigin,
        abortController: abortRefs.current.get(session.id),
        isActivityActive: () =>
          isSessionActivityActive(session.id),
        turnMatchesActivity: (queueId, turnId) =>
          turnMatchesSessionActivity(
            session.id,
            queueId,
            turnId,
          ),
        queueTurnMatchesActivity: (queueId) =>
          queueTurnMatchesSessionActivity(session.id, queueId),
        clearQueueDrain: () => clearQueueDrain(session.id),
        settleSession: sessions.settleInterruptedSession,
        transitionSessionJob,
        removeSteers: sessions.removeSteers,
        finishQueuedTurn: controller.finishQueuedTurn,
        releaseActivity: (queueId, turnId) =>
          releaseSessionActivity(
            session.id,
            queueId,
            turnId,
          ),
        isCurrentSession: () =>
          currentIdRef.current === session.id,
        deletePerSessionRefs: (sessionId) => {
          abortRefs.current.delete(sessionId)
          deliveredSteersRef.current.delete(sessionId)
          inFlightConfirmationRef.current.delete(sessionId)
          currentTurnIdRef.current.delete(sessionId)
          currentTurnJobIdRef.current.delete(sessionId)
          currentTurnRevisionRef.current.delete(sessionId)
        },
        applySessionSnapshot,
        setMessages,
        clearLiveActivities: () =>
          clearLiveActivitiesFor(session.id),
        clearLiveProcess: () =>
          clearLiveProcessFor(session.id),
        clearRunTasks: () => clearRunTasksFor(session.id),
        setStatus: setStatusFor,
      })
      if (settlement.cleanupError) {
        store.notify(
          `停止任务时清理状态失败：${errText(settlement.cleanupError)}`,
          'error',
        )
      }
      return settlement
    },
    [
      applySessionSnapshot,
      clearLiveActivitiesFor,
      clearLiveProcessFor,
      clearRunTasksFor,
      controller,
      sessions,
      setStatusFor,
      store,
      transitionSessionJob,
    ],
  )

  /**
   * 队列项的“直接引导”：带新素材的消息不能被中途改成引导，因为当前请求的视觉输入
   * 已经发出；普通文字则立即进入当前任务。若正停在确认卡，先取消这次待执行动作，
   * 再把消息作为新的用户回合发出去，避免旧动作先执行、引导最后才看到。
   */
  const guideQueuedTurn = useCallback(
    (turn: QueuedAgentTurn) =>
      trackRun(async () => {
        if (!current || !statusCanSteer(status)) return
        if (turn.pendingAssetIds?.length) {
          store.notify('带新素材的消息不能中途引导，请等它按队列发送', 'error')
          return
        }
        const queuedJob = await jobs.forTurn(current.id, turn.id)

        const pendingConfirmation =
          status.kind === 'awaitingConfirm' ? status.request : current.pendingConfirmation
        if (pendingConfirmation) {
          const withoutTurn = await sessions.removeQueuedTurn(current.id, turn.id)
          if (!withoutTurn) return
          applySessionSnapshot(withoutTurn)
          if (queuedJob?.status === 'queued') {
            await jobs.transition(
              queuedJob.id,
              'canceled',
              'canceled',
              {},
              { reason: 'promoted_to_steer' },
            )
          }
          const settled = await settleInterruptedSession(
            withoutTurn,
            pendingConfirmation,
            'canceled',
          )
          if (settled.cleanupError) return
          const target = settled.session ?? withoutTurn
          store.notify('已取消等待中的动作，并立即发送这条引导', 'info')
          await sendText(turn.text, sessionForQueuedTurn(target, turn))
          return
        }

        const promoted = await sessions.promoteQueuedTurnToSteer(
          current.id,
          turn.id,
          createId('steer'),
        )
        if (!promoted.ok) {
          store.notify(
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
        applySessionSnapshot(promoted.session)
        if (queuedJob?.status === 'queued') {
          await jobs.transition(
            queuedJob.id,
            'canceled',
            'canceled',
            {},
            { reason: 'promoted_to_steer' },
          )
        }
        setQueueMenuId(null)
        store.notify('已转为引导，将在 Agent 下一次动作前应用', 'info')
      }),
    [
    applySessionSnapshot,
    current,
    jobs,
    sendText,
    sessions,
    settleInterruptedSession,
    status,
    store,
    trackRun,
  ])

  /**
   * “直接下一步”是控制命令，不是聊天内容。先中止当前验收请求，再原子地
   * 验收当前步骤、启动下一步，最后用隐藏控制消息继续执行。
   */
  const advanceTaskPlan = useCallback(
    (session?: AgentSession) =>
      trackRun(async () => {
        const target = session ?? current
        if (!target?.taskPlan) {
          store.notify('当前没有可推进的任务计划', 'info')
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
          store.notify(advanced.problems.join('；'), 'error')
          return false
        }

        const pendingConfirmation =
          status.kind === 'awaitingConfirm' ? status.request : target.pendingConfirmation
        abortRefs.current.get(target.id)?.abort()
        if (pendingConfirmation) {
          const settled = await settleInterruptedSession(
            target,
            pendingConfirmation,
            'canceled',
          )
          if (settled.cleanupError) return false
        } else {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            if (!isSessionActivityActive(target.id)) break
            await new Promise((resolve) => window.setTimeout(resolve, 100))
          }
        }
        if (isSessionActivityActive(target.id)) {
          store.notify('旧验收仍在收尾，请稍后再点一次', 'error')
          return false
        }

        clearLiveActivitiesFor(target.id)
        clearLiveProcessFor(target.id)
        clearRunTasksFor(target.id)
        setStatusFor(target.id, IDLE_STATUS)
        const updated = await sessions.updateFields(target.id, {
          taskPlan: advanced.plan,
          pendingConfirmation: undefined,
          continuation: undefined,
          allowedToolNames: undefined,
        })
        const resolved = updated ?? { ...target, taskPlan: advanced.plan }
        applySessionSnapshot(resolved)

        const closed = currentStep?.title ?? '当前步骤'
        const next = advanced.plan.steps.find(
          (step) => step.id === advanced.plan.currentStepId,
        )
        if (!next) {
          store.notify(`已完成「${closed}」，整个计划已结束`, 'info')
          return true
        }
        store.notify(`已跳过「${closed}」验收，进入「${next.title}」`, 'info')
        await sendText(
          `系统控制：用户已跳过「${closed}」的验收并确认直接进入下一步。` +
            `现在开始执行计划步骤「${next.title}」。` +
            `请沿用计划目标、已有画布产物和约束继续，不要再次询问是否进入下一步，` +
            `也不要把这句控制指令当成新的业务需求。`,
          resolved,
          { internalControl: true },
        )
        return true
      }),
    [
    applySessionSnapshot,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    current,
    sendText,
    sessions,
    setStatusFor,
    settleInterruptedSession,
    status,
    store,
    trackRun,
  ])

  /**
   * 输入框里的“引导”：直接把当前草稿投进正在运行的回合。
   *
   * 普通运行中走 pendingSteers；停在确认卡时先取消未执行动作，再把这条消息
   * 作为新用户回合发起，避免用户还得先排队、展开列表、再点一次引导。
   */
  const guideDraft = useCallback(
    (raw: string) =>
      trackRun(async () => {
        const text = raw.trim()
        if (!text || !current) return false
        if (current.pendingAssetIds?.length) {
          store.notify('带新素材的消息不能中途引导，已改为排队发送', 'info')
          return queueText(text)
        }

        const pendingConfirmation =
          status.kind === 'awaitingConfirm' ? status.request : current.pendingConfirmation
        if (pendingConfirmation) {
          const settled = await settleInterruptedSession(
            current,
            pendingConfirmation,
            'canceled',
          )
          if (settled.cleanupError) return false
          const target = settled.session ?? current
          store.notify('已取消等待中的动作，并立即发送这条引导', 'info')
          await sendText(text, target)
          return true
        }

        const steered = await sessions.enqueueSteer(current.id, {
          id: createId('steer'),
          text,
          createdAt: Date.now(),
        })
        if (!steered.ok) {
          store.notify(
            steered.reason === 'full'
              ? '当前任务的引导已达上限'
              : '引导发送失败，请稍后重试',
            'error',
          )
          return false
        }
        applySessionSnapshot(steered.session)
        if (currentIdRef.current === current.id) {
          setDraft((value) => {
            const next = value.trim() === text ? '' : value
            if (next !== value) writeDraftForSession(current.id, next)
            return next
          })
        }
        store.notify('已作为引导发送，将在 Agent 下一次动作前应用', 'info')
        return true
      }),
    [
    applySessionSnapshot,
    current,
    queueText,
    sendText,
    sessions,
    settleInterruptedSession,
    status,
    store,
    trackRun,
    writeDraftForSession,
  ])

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

  const confirm = useCallback(() => {
    if (status.kind !== 'awaitingConfirm' || !current) return Promise.resolve()
    if (confirmingRef.current.has(current.id)) return Promise.resolve()
    confirmingRef.current.add(current.id)
    const { request } = status
    return trackRun(async () => {
      try {
        inFlightConfirmationRef.current.set(current.id, request)
        await runAgentConfirmation({
          session: current,
          request,
          messages,
          turnOrigin: () => ({
            jobId:
              currentTurnJobIdRef.current.get(current.id) ??
              controller.jobId(current.id),
            turnId:
              activeQueueTurnOf(current.id) ??
              currentTurnIdRef.current.get(current.id) ??
              controller.turnId(current.id),
            queueTurnId: activeQueueTurnOf(current.id),
            messageRevision:
              current.messageRevision ??
              currentTurnRevisionRef.current.get(current.id),
          }),
          beginConfirmation: controller.beginConfirmation,
          finishConfirmedTool: controller.finishConfirmedTool,
          executeConfirmedTool: executeConfirmedToolWithLedger,
          createLoopDeps: (args) => loopDeps(args),
          toolMode: () =>
            toolModeRef.current.get(current.id) ?? 'native',
          turnTools: () => turnToolsForSession(current),
          resumeAgentTurn,
          continueAutoConfirmations,
          handleOutcome,
          settleSessionOutcome,
          transitionSessionJob,
          setAbortController: (confirmationAbort) => {
            abortRefs.current.set(current.id, confirmationAbort)
          },
          setStatus: (next) => setStatusFor(current.id, next),
          isCurrentSession: () => currentIdRef.current === current.id,
          setMessages,
        })
      } finally {
        confirmingRef.current.delete(current.id)
        if (
          inFlightConfirmationRef.current.get(current.id)?.callId === request.callId
        ) {
          inFlightConfirmationRef.current.delete(current.id)
        }
      }
    })
  }, [
    status,
    current,
    messages,
    controller,
    executeConfirmedToolWithLedger,
    loopDeps,
    handleOutcome,
    settleSessionOutcome,
    setStatusFor,
    transitionSessionJob,
    continueAutoConfirmations,
    turnToolsForSession,
    trackRun,
  ])

  /**
   * 确认卡上的「取消」= 结束当前任务，交还控制权。
   *
   * 不回填工具结果会让历史里留下悬空 tool_call；自动续跑又会让模型换个方案
   * 继续建节点。两者都不是用户点“取消”的意思，所以只补取消结果、不续跑。
   */
  const cancel = useCallback(() => {
    if (status.kind !== 'awaitingConfirm' || !current) return Promise.resolve()
    if (confirmingRef.current.has(current.id)) return Promise.resolve()
    confirmingRef.current.add(current.id)
    const { request } = status
    return trackRun(async () => {
      try {
        const settled = await settleInterruptedSession(
          current,
          request,
          'canceled',
        )
        if (!settled.cleanupError) {
          store.notify('已取消；本次没有执行工具，也不会自动新增节点', 'info')
        }
      } finally {
        confirmingRef.current.delete(current.id)
      }
    })
  }, [
    status,
    current,
    settleInterruptedSession,
    store,
    trackRun,
  ])

  /** 轮数预算暂停后继续；工具结果已在 messages 中，不会重放已完成的调用。 */
  const continueTask = useCallback(() => {
    if (!current || status.kind !== 'paused') return Promise.resolve()
    return trackRun(async () => {
      await runAgentContinuation({
        session: current,
        messages,
        activeQueueTurnId: () => activeQueueTurnOf(current.id),
        currentTurnId: () =>
          currentTurnIdRef.current.get(current.id) ??
          controller.turnId(current.id),
        turnOrigin: (turnId, queueTurnId) => ({
          jobId:
            currentTurnJobIdRef.current.get(current.id) ??
            controller.jobId(current.id),
          turnId:
            turnId ??
            controller.turnId(current.id),
          queueTurnId,
          messageRevision:
            current.messageRevision ??
            currentTurnRevisionRef.current.get(current.id),
        }),
        isActivityActive: () => isSessionActivityActive(current.id),
        claimNextQueuedTurn: controller.claimNextQueuedTurn,
        claimActivity: (sessionId, queueTurnId, turnId) =>
          claimSessionActivity(sessionId, queueTurnId, turnId),
        applySessionSnapshot,
        ensureRoute: (session) => prepareChatRoute(session),
        createLoopDeps: (args) => loopDeps(args),
        toolMode: () => toolModeRef.current.get(current.id) ?? 'native',
        turnTools: () => turnToolsForSession(current),
        transitionSessionJob,
        setAbortController: (continuationAbort) => {
          abortRefs.current.set(current.id, continuationAbort)
        },
        setStatus: (next) => setStatusFor(current.id, next),
        runAgentTurn,
        continueAutoConfirmations,
        handleOutcome,
        settleSessionOutcome,
        isCurrentSession: () => currentIdRef.current === current.id,
        setMessages,
      })
    })
  }, [
    current,
    status,
    messages,
    controller,
    applySessionSnapshot,
    prepareChatRoute,
    loopDeps,
    setStatusFor,
    handleOutcome,
    settleSessionOutcome,
    transitionSessionJob,
    continueAutoConfirmations,
    turnToolsForSession,
    trackRun,
  ])

  const stop = useCallback(() => {
    if (!current || stoppingRef.current.has(current.id)) return Promise.resolve()
    stoppingRef.current.add(current.id)
    const session = current
    const request =
      inFlightConfirmationRef.current.get(session.id) ??
      (status.kind === 'awaitingConfirm' ? status.request : undefined)
    return trackRun(async () => {
      try {
        const settled = await settleInterruptedSession(
          session,
          request,
          'interrupted',
        )
        if (
          !settled.cleanupError &&
          (session.queuedTurns?.length ?? 0) > 0
        ) {
          store.notify('当前回合已停止，排队任务保留；可从队列手动继续', 'info')
        }
      } finally {
        stoppingRef.current.delete(session.id)
      }
    })
  }, [current, settleInterruptedSession, status, store, trackRun])

  const newSession = useCallback(
    () =>
      trackRun(async () => {
        const saved = await presets.loadAgentDefault()
        const savedModel = toLogicalName(allChannels, saved?.model ?? '')
        const created = await sessions.create({
          projectId,
          channelId: '',
          model: defaultModelFor(chatModelOptions, savedModel),
          /**
           * 「跟随选中」也覆盖**会话开局**这一档：用户先选中一张香蕉 2 的图再打开对话，
           * 面板上显示的就该是香蕉 2，而不是模型清单的第一个（见 `selectedModelOf`）。
           */
          imageModel: selectedModelOf('image') || modelOptionsByKind.image[0] || '',
          videoModel: selectedModelOf('video') || modelOptionsByKind.video[0] || '',
        })
        await refresh()
        await switchTo(created)
      }),
    [
    presets,
    sessions,
    projectId,
    allChannels,
    refresh,
    switchTo,
    defaultModelFor,
    chatModelOptions,
    modelOptionsByKind,
    selectedModelOf,
    trackRun,
  ])

  /**
   * 存会话上的任意字段：模型、技能、素材标签、比例 / 画质 / 质量都走这一条。
   *
   * `list` 必须**跟着一起改**：切走再切回时 `switchTo` 取的是 `list` 里的那一行，
   * 不同步的话「刚选好的模型 / 比例」会在切回时变回旧值 —— 而用户看到的是
   * 「选了下拉自己变回去」，只会当成功能坏了。更糟的是那份旧行会被下一次保存
   * 整份写回去，把库里的新值也冲掉。
   */
  const patchSession = useCallback(
    (patch: AgentSessionPatch) =>
      trackRun(async () => {
        if (!current) return
        const next = await sessions.updateFields(current.id, patch)
        if (!next) return
        setCurrent(next)
        setList((prev) => prev.map((s) => (s.id === next.id ? next : s)))
      }),
    [current, sessions, trackRun],
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

  /**
   * 选模型：只保存固定的前端逻辑名。
   *
   * 渠道由下一次真实发送时的 `resolveRoutedChatTarget()` 按全局策略解析，
   * 不写进会话。旧会话留下的 `channelId` 在这一刻清掉，避免继续沿用历史绑定。
   */
  const pickModel = useCallback(
    async (model: string) => {
      if (!current) return
      chatRouteRef.current.delete(current.id)
      await patchSession({ model, channelId: '' })
    },
    [current, patchSession],
  )

  /**
   * 图片 / 视频模型的点选（用户 2026-10-03：「我创作面板有什么模型就用什么模型，
   * 分了图片和视频…也就是说模型有三个选项」）。
   *
   * 只改会话上对应那一档 —— **对话模型不受影响**（那是 agent 自己跑的 LLM，
   * 与「建出来的生成节点用哪个模型」是两件事）。
   */
  const setModelKind = useCallback(
    async (key: 'imageModel' | 'videoModel', model: string) => {
      /**
       * 用户在面板上亲手选的模型，也要进「上次用过的」那一份 ——
       * 否则下一轮 agent 又会按旧值去建节点，用户看到的是「我明明换了模型它还用旧的」。
       */
      sessionRuntimeRef.current.rememberStickyModel(
        current!.id,
        key === 'videoModel' ? 'video' : 'image',
        model,
      )
      await patchSession({ [key]: model })
    },
    [patchSession],
  )

  /**
   * 手动 / 自动生成（用户 2026-10-02，参考产品图一那一档）。
   *
   * 「自动」= agent 请求落地 / 执行时**不再停下等确认**。默认必须是手动 ——
   * 默认替你花钱不是本项目愿意做的决定（设计文档 §9）。
   */
  const setAutoRun = useCallback(
    async (autoRun: boolean) => {
      if (!current) return
      /**
       * 本轮模型循环可能早就开始了，`sendText` 捕获的是旧的 `current`。
       * 先写实时 map，再落会话；这样用户在“思考中 / 正在执行”时切到自动，
       * 下一张确认卡到达就会按新值继续，而不是继续沿用开局的手动模式。
       */
      autoRunRef.current.set(current.id, autoRun)
      const resumeCurrent =
        autoRun &&
        status.kind === 'awaitingConfirm' &&
        !confirmationRequiresExplicitApproval(
          status.request.name,
          status.request.args,
        )
      await patchSession({ autoRun })
      /**
       * 已经停在确认卡时也要立刻接管：用户不是在预约“下一次自动”，
       * 而是要求这一刻起别再问。
       */
      if (resumeCurrent) await confirm()
    },
    [current, status, patchSession, confirm],
  )

  /**
   * 在输入框里插入一个 @ 引用（引用菜单里选完之后调它）。
   *
   * 走编辑器自己的 `insertMention`，而不是往 `draft` 里拼字符串：
   * 引用要落在**光标处**、要带 chip 的存储形态，这两件事只有编辑器知道。
   */
  /** 节点在正文里显示成什么名字（没起名就写「素材」，不露 `node_xxx`） */
  const nodeLabelOf = useCallback(
    (id: string) => {
      const hit = store.getSnapshot().nodes.find((n) => n.id === id)
      return (hit?.title ?? '').trim() || '素材'
    },
    [store],
  )

  /** 开始改名：把当前标题放进草稿，选中整段方便直接覆盖 */
  const startRename = useCallback(() => {
    if (!current) return
    setTitleDraft(current.title)
    setRenaming(true)
    setConfirmDelete(false)
  }, [current])

  /**
   * 提交改名。
   *
   * 空标题**不改**（回到原名）：允许存成空串的话，会话列表里会出现一行看不见的条目 ——
   * 那种「东西还在但认不出它是谁」的状态比拒绝一次输入糟得多。
   */
  const commitRename = useCallback(
    () =>
      trackRun(async () => {
        if (!current) return
        const title = titleDraft.trim()
        setRenaming(false)
        if (!title || title === current.title) return
        await sessions.rename(current.id, title)
        const rows = await refresh()
        const hit = rows.find((s) => s.id === current.id)
        if (hit) {
          setCurrent((previous) =>
            previous?.id === hit.id
              ? { ...previous, ...hit, messages: previous.messages }
              : hit,
          )
        }
      }),
    [current, titleDraft, sessions, refresh, trackRun],
  )

  /**
   * 删除会话（两步确认）。
   *
   * 删掉的正好是当前会话时，必须**当场换一个**：留着 current 指向一条已不存在的记录，
   * 界面上会继续显示它、下一句话还会往它的 id 上写 —— 那是最难查的一类不一致。
   * 一条都不剩时直接开一条新的，保证「至少有一个会话」这条不变式。
   */
  const deleteSession = useCallback(
    () =>
      trackRun(async () => {
        if (!current) return
        if (!confirmDelete) {
          setConfirmDelete(true)
          return
        }
        if (
          isSessionActivityActive(current.id) ||
          queuePumpingRef.current.has(current.id) ||
          confirmingRef.current.has(current.id)
        ) {
          setConfirmDelete(false)
          store.notify('当前会话还有任务在运行，请先停止后再删除', 'error')
          return
        }
        setConfirmDelete(false)
        clearDraftForSession(current.id)
        sessionRuntimeRef.current.clearSession(current.id)
        await sessions.remove(current.id)
        const rows = await refresh()
        if (rows.length > 0) await switchTo(rows[0]!)
        else await newSession()
      }),
    [
      current,
      confirmDelete,
      sessions,
      refresh,
      switchTo,
      newSession,
      store,
      clearDraftForSession,
      trackRun,
    ],
  )

  /**
   * 把**画布上选中的节点**当素材给这次对话（设计文档 §8「输入：文字 + 可选图片」）。
   *
   * 与拖图不同：这些节点早就落库了，不需要再导一次，直接把 id 记进会话 ——
   * agent 会用同一套 `attach` 复用它们。
   */
  /**
   * 多选浮层上那枚「添加到 agent」（用户 2026-10-05 第 11 条，参考图四第六个动作）。
   *
   * 画布侧与对话窗是**兄弟组件**，两边靠 `agentHandoff` 那个模块级单例交接（说明见
   * 那个文件）。这里做两件事，顺序不能反：
   * ① 先把 ids 落进**当前会话**（`pendingAssetIds`）并补成正文 chip —— 与
   *    用户看到的引用与普通 @ 节点保持同一种形态；
   * ② 取走即清空（`takeAgentHandoff`），否则每次切会话 / 重渲染都会再收一遍。
   *
   * 为什么用 ref 缓冲而不是直接消费：面板刚打开时 `current` 可能还没就绪
   * （会话是异步读回来的），那一拍消费掉就等于**用户点了按钮却什么都没发生**。
   * 所以 ids 先进 ref，能落会话了就落（`flushHandoff` 在 `current` 变好之后也会被
   * 这个 effect 重新跑一次）。
   */
  const handoffRef = useRef<string[]>([])
  const flushHandoff = useCallback(() => {
    if (!current || handoffRef.current.length === 0) return
    const exist = new Set(store.getSnapshot().nodes.map((n) => n.id))
    const picked = handoffRef.current.filter((id) => exist.has(id))
    handoffRef.current = []
    if (picked.length === 0) return
    for (const id of picked) insertMention('node', id, nodeLabelOf(id))
    patchSessionDetached({
      pendingAssetIds: [...new Set([...(current.pendingAssetIds ?? []), ...picked])],
    })
  }, [current, store, insertMention, nodeLabelOf, patchSession])

  useEffect(() => {
    if (!active) return
    const queue = (ids: readonly string[]) => {
      handoffRef.current = [...new Set([...handoffRef.current, ...ids])]
      flushHandoff()
    }
    /** 面板可能是**后**挂载的（点按钮才打开），先把单例里存着的那批收下 */
    queue(takeAgentHandoff(projectId))
    return subscribeAgentHandoff(projectId, queue)
  }, [active, flushHandoff, projectId])

  /**
   * 本会话启用的技能（设计文档 §14 M4）。
   *
   * 存 **id** 不存正文：技能在库里改了，会话跟着用新版 ——
   * 与画布节点上的 `skillId` 同一口径（存正文等于把那一刻冻结住）。
   */
  const setSkill = useCallback(
    async (skillId: string) => {
      await patchSession({ skillId: skillId || undefined })
    },
    [patchSession],
  )

  const navigate = useNavigate()

  /**
   * 导入技能（用户 2026-10-03：「导入已有 skill（通过设定好的 skill 流程去解析 md
   * 文件或者文件夹）」）。
   *
   * 解析与落库**复用技能库那一页同一套**（`parseSkillMarkdown` + `skills.create`），
   * 一处都没另写。逐个独立成败：一个文件格式不对，不该让同批的其余几个也失败。
   */
  const importSkills = useCallback(
    (files: FileList | null) =>
      trackRun(async () => {
        if (!files || files.length === 0) return
        let ok = 0
        const failed: string[] = []
        for (const file of Array.from(files)) {
          if (!/\.(md|markdown|txt)$/i.test(file.name)) continue
          try {
            const parsed = parseSkillMarkdown(
              await file.text(),
              file.name.replace(/\.(md|markdown|txt)$/i, ''),
            )
            if (!parsed.ok) {
              failed.push(`${file.name}：${parsed.error}`)
              continue
            }
            await skills.create(parsed.skill)
            ok += 1
          } catch (e) {
            failed.push(`${file.name}：${e instanceof Error ? e.message : errText(e)}`)
          }
        }
        await skills.reload()
        setOpenPicker(null)
        store.notify(
          failed.length === 0
            ? `已导入 ${ok} 条技能`
            : `导入 ${ok} 条，${failed.length} 条失败：${failed[0]}`,
          failed.length === 0 ? 'info' : 'error',
        )
      }),
    [skills, store, trackRun],
  )

  /**
   * 去技能库。
   *
   * 「创建新的 Skill」与「全部」都走这里：**编辑一份技能**（写正文、改名字、
   * 复制内置）只有在技能库那一页才有完整界面，在这里再搭一个编辑器是重复建设。
   */
  const openSkillLibrary = useCallback(() => {
    setOpenPicker(null)
    navigate('/skills')
  }, [navigate])

  /** 一进面板就把收藏读回来（它是 UI 偏好，住 `presets`，与 Agent 默认模型同一套） */
  useEffect(() => {
    let alive = true
    void (async () => {
      const ids = await presets.loadSkillFavorites()
      if (alive) setSkillFavs(ids)
    })()
    return () => {
      alive = false
    }
  }, [presets])

  /**
   * 切换收藏。
   *
   * **先改界面、再落库**（与素材库取消收藏同一手法）：收藏是瞬时的视觉反馈，
   * 等一次 IndexedDB 往返再打星会让人以为没点上；落库失败最坏也只是下次没记住。
   */
  const toggleSkillFavorite = useCallback(
    (id: string) =>
      trackRun(async () => {
        const next = skillFavs.includes(id)
          ? skillFavs.filter((x) => x !== id)
          : [...skillFavs, id]
        setSkillFavs(next)
        await presets.saveSkillFavorites(next)
      }),
    [skillFavs, presets, trackRun],
  )

  /**
   * 把一份素材落到画布上，**避开已有节点**。
   *
   * 抽出来是因为现在有**两条**入口：本地上传（`attachFiles`）与素材库添加
   * （`addFromLibrary`）。两处各写一遍落位与建节点，迟早有一条忘了避让、
   * 把新素材压在别人节点上 —— 那种「两张图叠一起」2026-10-01 实测踩过一次。
   */
  const placeAsset = useCallback(
    (asset: ImportedAsset): string | null => {
      const size = assetNodeSize({ width: asset.width, height: asset.height })
      const existing = store
        .getSnapshot()
        .nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
      const centered = centeredNodeOrigin(size, viewportWorldOf(viewport))
      const spot = findFreeRect({ ...size, ...centered }, existing)
      return createAssetNode({ platform, store, projectId }, asset, { x: spot.x, y: spot.y })
    },
    [platform, store, projectId, viewport],
  )

  /**
   * 从**素材库**挑一个加进这次对话（用户 2026-10-03：「加素材…分两个功能，
   * 点击后本地上传和素材库添加」）。
   *
   * 与本地导入走**同一条落位链路**（`placeAsset`），也记进 `pendingAssetIds` ——
   * 对 agent 来说两者没有区别，都是「画布上那个素材节点」，用 attach 复用即可。
   */
  const addFromLibrary = useCallback(
    (hash: string) =>
      trackRun(async () => {
        const asset = library.getState().assets.find((a) => a.hash === hash)
        if (!current || !asset) return
        const id = placeAsset({
          hash: asset.hash,
          mime: asset.mime,
          width: asset.width,
          height: asset.height,
        })
        if (!id) return
        /** 同样落成正文里的引用 chip（与「取选中」同一条路） */
        insertMention('node', id, nodeLabelOf(id))
        await patchSession({ pendingAssetIds: [...(current.pendingAssetIds ?? []), id] })
      }),
    [
      current,
      library,
      patchSession,
      placeAsset,
      insertMention,
      nodeLabelOf,
      trackRun,
    ],
  )

  /**
   * 用户给素材：**先落成画布上的节点**，再记进会话（设计文档 §8）。
   *
   * 为什么不把图片塞进对话上下文：agent 要用它时得能 `attach` 到那个节点上
   * （复用、不重复建）。只塞上下文的话，模型只能「知道有这么一张图」，
   * 却指不到画布上的任何东西，最后还是自己再建一个 —— 那就重复了。
   */
  const attachFiles = useCallback(
    (files: FileList | null) =>
      trackRun(async () => {
        if (!files || files.length === 0 || !current) return
        const deps = { platform, store, projectId }
        const added: string[] = []
        for (const file of Array.from(files)) {
          if (!isImportableMedia(file.type)) continue
          const asset = await importAssetFile(deps, file)
          if (!asset) continue
          const id = placeAsset(asset)
          if (id) added.push(id)
        }
        if (added.length === 0) return
        for (const id of added) insertMention('node', id, nodeLabelOf(id))
        await patchSession({
          pendingAssetIds: [...(current.pendingAssetIds ?? []), ...added],
        })
      }),
    [
      current,
      platform,
      store,
      projectId,
      patchSession,
      placeAsset,
      insertMention,
      nodeLabelOf,
      trackRun,
    ],
  )

  const latestUserIndex = visibleItems.reduce(
    (at, item, index) => (item.kind === 'user' ? index : at),
    -1,
  )
  const latestUserStartedAt =
    latestUserIndex >= 0 && visibleItems[latestUserIndex]?.kind === 'user'
      ? visibleItems[latestUserIndex]?.createdAt
      : undefined
  const latestProcessIndex = visibleItems.reduce(
    (at, item, index) =>
      item.kind === 'process' && index > latestUserIndex ? index : at,
    -1,
  )
  const currentTurnHasProcess = visibleItems
    .slice(latestUserIndex + 1)
    .some((item) => item.kind === 'process')
  /** 节点 id → 产物 hash：步骤卡据此把这一步产出的图**内嵌**显示（图变更时跟着刷） */
  const hashOfNode = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of graph.nodes) {
      const hash = (n.data as { assetHash?: unknown }).assetHash
      if (typeof hash === 'string' && hash) map.set(n.id, hash)
    }
    return map
  }, [graph])

  /**
   * @ 引用里的**节点缩略图**（用户 2026-10-03，参考产品图六：chip 上要看得见那张图）。
   *
   * 编辑器是**命令式建的 DOM**、拿不到 `useAsset` 这类 hook，所以图在这里取：
   * 按草稿里出现过的节点 id 去 `assets` 表读一次，缓存成 `nodeId → objectURL`，
   * 再用版本号通知编辑器**就地**把图补进槽位。
   */
  const thumbCacheRef = useRef(new Map<string, string>())
  const [thumbVersion, setThumbVersion] = useState(0)
  const thumbOf = useCallback(
    (nodeId: string) => thumbCacheRef.current.get(nodeId) ?? null,
    [],
  )

  useEffect(() => {
    /**
     * 取图的两种来源：正文里的 @ 引用，以及「取选中当素材」挂上的标签。
     *
     * 后者原先不取图 ⇒ 标签上只能写 `node_xxx`（用户 2026-10-02 报的那一条）。
     */
    const refs = [
      ...parseMentions(draft).filter((m) => m.kind === 'node'),
      ...(current?.pendingAssetIds ?? []).map((id) => ({ kind: 'node' as const, id })),
      /**
       * **历史消息里的引用也要取图**：用户消息现在按 chip 渲染（见 `MentionRichText`），
       * 回看时要能看见当时引用的那张缩略图 —— 只按草稿取图的话，发出去就变回纯图标。
       */
      ...messages.flatMap((m) =>
        parseMentions(m.display ?? m.content).filter((x) => x.kind === 'node'),
      ),
    ]
    if (refs.length === 0) return
    let alive = true
    void (async () => {
      let added = false
      for (const r of refs) {
        if (thumbCacheRef.current.has(r.id)) continue
        const hash = hashOfNode.get(r.id)
        if (!hash) continue
        const meta = await loadAssetUrl(platform, hash)
        if (!alive || !meta.url) continue
        thumbCacheRef.current.set(r.id, meta.url)
        added = true
      }
      if (added && alive) setThumbVersion((v) => v + 1)
    })()
    return () => {
      alive = false
    }
  }, [draft, hashOfNode, platform, current?.pendingAssetIds, messages])

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

  /** 卸载时把建出来的 objectURL 回收掉（不回收就是一路泄漏） */
  useEffect(
    () => () => {
      for (const url of thumbCacheRef.current.values()) URL.revokeObjectURL(url)
      thumbCacheRef.current.clear()
    },
    [],
  )

  const pendingPlan = previewOf(status, store)
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
    <aside
      className={styles.panel}
      data-agent-panel
      data-agent-session-id={current?.id}
      /**
       * Esc **先关参数浮层**（与创作面板同一条口径：想收起下拉，结果把整块面板
       * 一起关掉是最容易踩的那一脚）。
       *
       * 两条纪律，都是从创作面板那边学来的：
       * ① 浮层开着的 Esc 只关浮层，**不关对话窗** —— 对话窗是常驻面板，
       *    在输入框里按 Esc 本意多半是「算了」，不该把整块面板收走；
       * ② 消费掉就 `preventDefault()` 声明出来。`NodeFollowBar` 挂在 window 上
       *    监听 Esc 并清空选中，不声明的话一次 Esc 会做两件事。
       */
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !openPicker) return
        e.preventDefault()
        setOpenPicker(null)
      }}
      /* 拖图进来就是「给 agent 一张素材」（设计文档 §8） */
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        runPromiseDetached(
          attachFiles(e.dataTransfer?.files ?? null),
          '添加素材失败',
        )
      }}
    >
      {/*
        头部：会话名 + 一排图标钮（新建 / 改名 / 删除 / 收起）。

        参考产品（liblib.tv）就是这么排的：标题占左，动作收成图标。
        本面板不到 400px 宽，四项文字按钮一排会把会话名挤到看不清 ——
        图标 + title 提示，鼠标停上去才知道是什么，这点与画布工具栏同一口径。
      */}
      <AgentPanelHeader
        sessions={list}
        current={current}
        renaming={renaming}
        titleDraft={titleDraft}
        pickerOpen={openPicker === 'agent-session'}
        confirmDelete={confirmDelete}
        onTitleDraftChange={setTitleDraft}
        onCommitRename={() =>
          runPromiseDetached(commitRename(), '重命名失败')}
        onCancelRename={() => setRenaming(false)}
        onToggleSessionPicker={() =>
          setOpenPicker(
            openPicker === 'agent-session' ? null : 'agent-session',
          )
        }
        onClosePicker={() => setOpenPicker(null)}
        onSwitchSession={(session) => void switchTo(session)}
        onNewSession={() =>
          runPromiseDetached(newSession(), '新建会话失败')}
        onStartRename={startRename}
        onDeleteSession={() =>
          runPromiseDetached(deleteSession(), '删除会话失败')}
        onOpenSettings={onOpenSettings}
        onClose={onClose}
      />

      <AgentConversationPane
        current={current}
        status={status}
        items={items}
        visibleItems={visibleItems}
        latestProcessIndex={latestProcessIndex}
        streamingTextIndex={streamingTextIndex}
        liveActivities={liveActivities}
        liveProcess={liveProcess}
        runTasks={runTasks}
        copiedKey={copiedKey}
        expanded={expanded}
        hashOfNode={hashOfNode}
        thumbOf={thumbOf}
        currentTurnHasProcess={currentTurnHasProcess}
        latestUserStartedAt={latestUserStartedAt}
        pendingPlan={pendingPlan}
        pendingTaskStepId={pendingTaskStepId}
        advancingTaskPlan={advancingTaskPlan}
        scrollRef={scrollRef}
        showJumpToLatest={showJumpToLatest}
        queueMenuId={queueMenuId}
        queueMenuPosition={queueMenuPosition}
        editingQueueId={editingQueueId}
        editingQueueTurn={editingQueueTurn}
        editingQueueText={editingQueueText}
        onConversationScroll={onConversationScroll}
        onCopyReply={(key, text) => void copyReply(key, text)}
        onRetry={retry}
        onToggleStep={toggleStep}
        onAdvanceToNext={() => {
          if (!current) return
          if (advancingTaskPlan) return
          setAdvancingTaskPlan(true)
          runPromiseDetached(
            advanceTaskPlan(current).finally(() => {
              setAdvancingTaskPlan(false)
            }),
            '推进任务计划失败',
          )
        }}
        onContinueTask={() =>
          runPromiseDetached(continueTask(), '继续任务失败')}
        onConfirm={() =>
          runPromiseDetached(confirm(), '确认执行失败')}
        onCancel={() =>
          runPromiseDetached(cancel(), '取消任务失败')}
        onJumpToLatest={jumpToLatest}
        onGuideQueuedTurn={(turn) =>
          runPromiseDetached(guideQueuedTurn(turn), '转为引导失败')}
        onRemoveQueued={(turnId) =>
          runPromiseDetached(removeQueued(turnId), '移出队列失败')}
        onQueueMenuIdChange={setQueueMenuId}
        onQueueMenuPositionChange={setQueueMenuPosition}
        onBeginQueueEdit={beginQueueEdit}
        onCommitQueueEdit={() =>
          runPromiseDetached(commitQueueEdit(), '保存队列编辑失败')}
        onEditingQueueIdChange={setEditingQueueId}
        onEditingQueueTextChange={setEditingQueueText}
        onResumeQueue={() =>
          runPromiseDetached(resumeQueue(), '恢复队列失败')}
      />

      <AgentComposerPane
        current={current}
        status={status}
        deliveryMode={deliveryMode}
        draft={draft}
        composerHeight={composerHeight}
        composerResizing={composerResizing}
        openPicker={openPicker}
        shownModel={shownModel}
        chatModelOptions={chatModelOptions}
        modelOptionsByKind={modelOptionsByKind}
        globalImageModels={globalImageModels}
        globalVideoModels={globalVideoModels}
        mentionedModels={mentionedModels}
        graph={graph}
        libraryAssets={libraryAssets}
        allSkills={allSkills}
        skillLabel={skillLabel}
        skillFavs={skillFavs}
        skills={skills}
        thumbVersion={thumbVersion}
        editorRef={editorRef}
        composerRef={composerRef}
        fileRef={fileRef}
        skillFileRef={skillFileRef}
        skillDirRef={skillDirRef}
        composerAvailableHeight={composerAvailableHeight}
        beginComposerResize={beginComposerResize}
        resizeComposerWithKeyboard={resizeComposerWithKeyboard}
        replaceDraft={replaceDraft}
        send={send}
        stop={() => runPromiseDetached(stop(), '停止任务失败')}
        attachFiles={(files) =>
          runPromiseDetached(attachFiles(files), '添加素材失败')}
        addFromLibrary={(hash) =>
          runPromiseDetached(addFromLibrary(hash), '添加素材失败')}
        pickModel={(name) =>
          runPromiseDetached(pickModel(name), '保存模型设置失败')}
        setModelKind={(kind, value) =>
          runPromiseDetached(
            setModelKind(kind, value),
            '保存模型设置失败',
          )}
        setSkill={(id) =>
          runPromiseDetached(setSkill(id), '保存技能设置失败')}
        toggleSkillFavorite={(id) =>
          runPromiseDetached(
            toggleSkillFavorite(id),
            '保存技能收藏失败',
          )}
        openSkillLibrary={openSkillLibrary}
        importSkills={(files) =>
          runPromiseDetached(importSkills(files), '导入技能失败')}
        patchSession={patchSessionDetached}
        setAutoRun={(value) =>
          runPromiseDetached(setAutoRun(value), '保存自动执行设置失败')}
        insertMention={insertMention}
        setDraft={setDraft}
        setOpenPicker={setOpenPicker}
        thumbOf={thumbOf}
        channels={channels}
        library={library}
      />
    </aside>
  )
}
