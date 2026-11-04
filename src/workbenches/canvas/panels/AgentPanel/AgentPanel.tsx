import type { TaskShutdownControl } from '../../../../features/shared/lifecycle/taskLifecycle'
import { AgentPanelView } from './AgentPanelView'
import { useAgentPanelRefs } from './useAgentPanelRefs'
import { useAgentPanelSessionModel } from './useAgentPanelSessionModel'
import { useAgentPanelToolModel } from './useAgentPanelToolModel'
import { useAgentPanelTurnModel } from './useAgentPanelTurnModel'
import { useAgentPanelViewProps } from './useAgentPanelViewProps'

/**
 * 画布右侧的 Agent 对话窗（设计文档 §7 / §8）。
 *
 * 界面把循环的三种「停法」如实呈现出来 —— 这是设计里最容易被做糊的一处：
 * 只有一个转圈的话，用户分不清它是**在想**、**在建**、还是**在等他点确认**。
 *
 * 本文件只剩**接线**：三个领域模型各管一段（会话 / 工具 / 回合），
 * 组装成 `AgentPanelView` 的 props。任何一段的 state、ref、effect、
 * controller 端口都在各自的 `useAgentPanel*Model` 里。
 * 下面这张 props 表是**唯一的接线图**，别把它拆散 —— 排查「这个按钮为什么没反应」
 * 时需要一眼扫完「它拿到的是谁」。
 */
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
  const refs = useAgentPanelRefs()
  const session = useAgentPanelSessionModel({ projectId, active, refs })
  const tool = useAgentPanelToolModel({ session, refs })
  const turn = useAgentPanelTurnModel({
    session,
    tool,
    refs,
    onDisposeReady,
  })

  const viewProps = useAgentPanelViewProps({
    // ---- 会话与消息 ----
    current: session.current,
    sessions: session.list,
    sessionActions: session.sessionActions,
    switchTo: session.switchTo,
    onOpenSettings,
    onClose,
    runPromiseDetached: session.runPromiseDetached,
    status: session.status,

    // ---- 对话展示 ----
    items: session.items,
    visibleItems: session.visibleItems,
    latestProcessIndex: session.latestProcessIndex,
    streamingTextIndex: session.streamingTextIndex,
    liveActivities: session.liveActivities,
    liveProcess: session.liveProcess,
    runTasks: session.runTasks,
    copiedKey: session.copiedKey,
    expanded: session.expanded,
    hashOfNode: session.hashOfNode,
    thumbOf: session.thumbOf,
    currentTurnHasProcess: session.currentTurnHasProcess,
    latestUserStartedAt: session.latestUserStartedAt,
    scrollRef: session.scrollRef,
    showJumpToLatest: session.showJumpToLatest,
    onConversationScroll: session.onConversationScroll,
    copyReply: session.copyReply,
    toggleStep: session.toggleStep,
    jumpToLatest: session.jumpToLatest,

    // ---- 确认 / 继续 / 任务计划 ----
    pendingPlan: turn.pendingPlan,
    pendingTaskStepId: turn.pendingTaskStepId,
    advancingTaskPlan: turn.advancingTaskPlan,
    advanceTaskPlan: turn.advanceTaskPlan,
    continueTask: turn.continueTask,
    confirm: turn.confirm,
    cancel: turn.cancel,
    retry: turn.retry,

    // ---- 队列 ----
    queueMenuId: session.queueMenuId,
    queueMenuPosition: session.queueMenuPosition,
    setQueueMenuId: session.setQueueMenuId,
    setQueueMenuPosition: session.setQueueMenuPosition,
    editingQueueId: turn.editingQueueId,
    editingQueueTurn: turn.editingQueueTurn,
    editingQueueText: turn.editingQueueText,
    setEditingQueueId: turn.setEditingQueueId,
    setEditingQueueText: turn.setEditingQueueText,
    beginQueueEdit: turn.beginQueueEdit,
    commitQueueEdit: turn.commitQueueEdit,
    resumeQueue: turn.resumeQueue,
    removeQueued: turn.removeQueued,
    guideQueuedTurn: turn.guideQueuedTurn,

    // ---- 输入框 / 模型 / 技能 ----
    deliveryMode: session.deliveryMode,
    composerController: session.composerController,
    openPicker: session.openPicker,
    setOpenPicker: session.setOpenPicker,
    shownModel: session.shownModel,
    chatModelOptions: session.chatModelOptions,
    modelOptionsByKind: session.modelOptionsByKind,
    globalImageModels: session.globalImageModels,
    globalVideoModels: session.globalVideoModels,
    mentionedModels: session.mentionedModels,
    pickModel: session.pickModel,
    setModelKind: session.setModelKind,
    allSkills: session.allSkills,
    skillLabel: session.skillLabel,
    skillFavs: session.skillFavs,
    skills: session.skills,
    setSkill: session.setSkill,
    toggleSkillFavorite: session.toggleSkillFavorite,
    openSkillLibrary: session.openSkillLibrary,
    importSkills: session.importSkills,
    skillFileRef: session.skillFileRef,
    skillDirRef: session.skillDirRef,
    send: turn.send,
    stop: turn.stop,
    setAutoRun: turn.setAutoRun,
    patchSession: session.patchSessionDetached,

    // ---- 素材 / 画布 ----
    graph: session.graph,
    library: session.library,
    libraryAssets: session.libraryAssets,
    thumbVersion: session.thumbVersion,
    fileRef: session.fileRef,
    attachFiles: session.attachFiles,
    addFromLibrary: session.addFromLibrary,
    channels: session.channels,
  })

  return <AgentPanelView {...viewProps} />
}
