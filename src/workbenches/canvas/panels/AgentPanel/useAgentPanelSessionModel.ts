import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { usePlatform } from '../../../../app/providers/PlatformProvider'
import { useChannels } from '../../../../app/providers/ChannelStoreProvider'
import { useSkillsOptional } from '../../../../app/providers/SkillStoreProvider'
import { createAgentSessionStore, type AgentSession } from '../../../../state/agent/sessionStore'
import { createAgentJobStore } from '../../../../state/agent/jobStore'
import { createPresetStore } from '../../../../state/project/presetStore'
import { generationAvailabilityOf } from '../../../../domain/project/generationRouting'
import { isSessionActivityActive } from '../../../../features/canvas/agent/sessionActivity'
import { createAssetLibraryRepository } from '../../../../state/project/assetLibraryRepository'
import { createAssetLibraryStore } from '../../../../state/project/assetLibraryStore'
import { createInspirationRepository } from '../../../../state/project/inspirationRepository'
import { useCanvasExecution } from '../../execution/CanvasExecutionProvider'
import { useCanvasStore, useGraph, useSelection, useViewportState } from '../../storeContext'
import { agentToolsForCapabilities } from '../../agent/tools'
import { createAgentController } from '../../../../features/shared/agent/AgentController'
import { createAgentMemoryPort } from '../../../../features/shared/agent/MemoryPort'
import { createAgentToolEffectLedger } from '../../../../features/shared/agent/AgentToolEffectLedger'
import { createContextRepository } from '../../../../state/shared/contextRepository'
import {
  TaskLifecycleClosedError,
  createTaskLifecycle,
  type TaskLifecycle,
} from '../../../../features/shared/lifecycle/taskLifecycle'
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
import { errText } from '../../agent/agentLoop'
import { IDLE_STATUS, type AgentPanelStatus as Status } from './AgentActivityViews'
import type { AgentQueueMenuPosition } from './AgentQueuePanel'
import { useAgentRunPresentation } from './useAgentRunPresentation'
import { useAgentSessionLifecycle } from './useAgentSessionLifecycle'
import { useAgentComposerController } from './useAgentComposerController'
import { useAgentChatRouting } from './useAgentChatRouting'
import { useAgentModelSelectionController } from './useAgentModelSelectionController'
import { useAgentInitialLoadController } from './useAgentInitialLoadController'
import { useAgentSessionActionsController } from './useAgentSessionActionsController'
import { useAgentSkillsController } from './useAgentSkillsController'
import { useAgentSkillChipReset } from './useAgentSkillChipReset'
import { useAgentAttachmentsController } from './useAgentAttachmentsController'
import {
  useAgentConversationController,
  type AgentMessageReveal,
} from './useAgentConversationController'
import type { AgentPanelRefs } from './useAgentPanelRefs'

/**
 * 会话领域：**列表 / 当前会话 / 消息 / 草稿 / 状态 / 会话动作 / 队列菜单 / 技能 / 素材**
 *
 * 这里是 `AgentPanel` 原来那 1653 行里最靠近「数据」的一半：它建 store、建 controller、
 * 管 initial load、管输入框与模型选择、管对话滚动。面板本身不再持有任何一份 state。
 *
 * 三条纪律：
 * 1. **不搬顺序**：发送、确认、继续、中断收口的顺序都在各自的模块里，这里只组织状态。
 * 2. **per-session 的 Map / Set 一律来自 `useAgentPanelRefs`**，本文件不新建。
 * 3. 除原有 `useMemo` / `useCallback` 外不新增缓存（身份抖动比多几行危险）。
 */
export type AgentPanelSessionPatch = Partial<
  Omit<
    AgentSession,
    'id' | 'projectId' | 'messages' | 'queuedTurns' | 'createdAt'
  >
>

export interface AgentPanelSessionModelInput {
  projectId: string
  /** 常驻宿主仍可处于后台；只有当前可见画布才接收一次性 handoff。 */
  active: boolean
  refs: AgentPanelRefs
}

export function useAgentPanelSessionModel({
  projectId,
  active,
  refs,
}: AgentPanelSessionModelInput) {
  const { sessionRuntimeRef } = refs
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
  /** 刚复制过哪一条助手回复：图标短暂换成对勾，给用户一个「确实复制了」的回执 */
  const [copiedKey, setCopiedKey] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
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
    (patch: AgentPanelSessionPatch) => void
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
    openPicker,
    setOpenPicker,
    composerHeight,
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
      refs.queuePumpingRef.current.has(sessionId) ||
      refs.confirmingRef.current.has(sessionId),
    isCurrentSession: (sessionId) => currentIdRef.current === sessionId,
    describeError: errText,
    notify: store.notify,
  })
  sessionActionsResetRef.current = sessionActions.resetForSessionSwitch

  /**
   * 存会话上的任意字段：模型、技能、素材标签、比例 / 画质 / 质量都走这一条。
   *
   * `list` 必须**跟着一起改**：切走再切回时 `switchTo` 取的是 `list` 里的那一行，
   * 不同步的话「刚选好的模型 / 比例」会在切回时变回旧值 —— 而用户看到的是
   * 「选了下拉自己变回去」，只会当成功能坏了。更糟的是那份旧行会被下一次保存
   * 整份写回去，把库里的新值也冲掉。
   */
  const patchSession = useCallback(
    async (patch: AgentPanelSessionPatch) => {
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
   * 正文 chip → 会话字段（反向）：用户把主动插入的技能 chip 删掉 = **这次不用这个技能**。
   *
   * 不能再用「正文非空但没有技能 chip」来判断：进入会话时技能本来就不再自动
   * 写进正文，用户正常打字也会命中这个条件。这里只认一次真实删除 —— 同一个
   * 会话、同一个技能，上一拍正文里见过这枚 chip，下一拍它消失了。
   *
   * 发送之后正文会被清空，那一瞬间不该把设置也一并清光（技能是「本会话挂着的
   * 东西」，不是「这一条的附件」）。
   */
  useAgentSkillChipReset({
    current,
    draft,
    setSkill,
    runPromiseDetached,
  })

  const applySessionSnapshot = useCallback((next: AgentSession) => {
    if (next.messageRevision !== undefined) {
      refs.currentTurnRevisionRef.current.set(
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

  return {
    // ---- 三个领域 hook 之间传递的底座 ----
    platform,
    channels,
    store,
    selection,
    viewport,
    execution,
    skills,
    controller,
    sessions,
    jobs,
    ensureAgentJob,
    transitionSessionJob,
    toolEffects,
    memory,
    presets,
    library,
    libraryAssets,
    inspirationRepository,
    runPresentation,
    lifecycle,
    trackRun,
    runPromiseDetached,
    runTrackedDetached,
    runSync,

    // ---- 会话与消息 ----
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
    patchSessionFields,
    patchSession,
    patchSessionDetached,
    renameSession,
    removeSession,
    sessionActions,
    applySessionSnapshot,

    // ---- 状态与呈现 ----
    status,
    runTasks,
    liveActivities,
    liveProcess,
    setStatusFor,
    setRunTasksFor,
    setLiveActivityFor,
    appendLiveProcessFor,
    clearLiveActivitiesFor,
    clearLiveProcessFor,
    clearRunTasksFor,
    deliveryMode,
    reviewModel,
    canvasReviewEnabled,
    activeAgentTools,

    // ---- 输入框 / 模型 / 技能 / 素材 ----
    composerController,
    draft,
    setDraft,
    openPicker,
    setOpenPicker,
    composerHeight,
    insertMention,
    cancelPendingAssetSync,
    writeDraftForSession,
    clearDraftForSession,
    enabled,
    generationAvailability,
    allChannels,
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
    allSkills,
    skillFavs,
    skillLabel,
    skillFileRef,
    skillDirRef,
    setSkill,
    importSkills,
    openSkillLibrary,
    toggleSkillFavorite,
    fileRef,
    graph,
    hashOfNode,
    thumbOf,
    thumbVersion,
    attachFiles,
    addFromLibrary,

    // ---- 对话展示 ----
    items,
    visibleItems,
    expanded,
    toggleStep,
    showJumpToLatest,
    setShowJumpToLatest,
    stickToLatestRef,
    clearReveal,
    onConversationScroll,
    jumpToLatest,
    streamingTextIndex,
    scrollRef,
    latestUserStartedAt,
    latestProcessIndex,
    currentTurnHasProcess,
    setMessageReveal,
    copiedKey,
    copyReply,

    // ---- 聊天路由 ----
    modelRoute,
    routeExecution,
    cachedChatRoute,
    prepareChatRoute,
    commitChatRoute,
    clearChatRoute,
    clearChatRoutes,

    // ---- 队列菜单（UI 状态，回合侧只读它的 setter） ----
    queueMenuId,
    queueMenuPosition,
    setQueueMenuId,
    setQueueMenuPosition,
  }
}

export type AgentPanelSessionModel = ReturnType<typeof useAgentPanelSessionModel>
