import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import type { AgentPanelViewProps } from './AgentPanelView'
import type { AgentPanelHeaderProps } from './AgentPanelHeader'
import type { AgentConversationPaneProps } from './AgentConversationPane'
import type { AgentComposerPaneProps } from './AgentComposerPane'
import type { AgentDeliveryMode } from '../../../../domain/agent/delivery'
import type { AgentComposerController } from './useAgentComposerController'
import type { AgentSessionActionsController } from './useAgentSessionActionsController'

type ViewProps = AgentPanelViewProps
type Header = AgentPanelHeaderProps
type Conversation = AgentConversationPaneProps
type Composer = AgentComposerPaneProps
type SessionActions = AgentSessionActionsController
type ComposerController = AgentComposerController
type QueuedTurn = AgentSession['queuedTurns'][number]

/**
 * 把面板尾部那三个 prop 包（header / conversation / composer）的装配搬出 JSX。
 *
 * **这不是 UI 结构改动**：`AgentPanelView` 收到的字段名与值逐项不变，只是从
 * 内联字面量变成这里的返回值。三条约束：
 * 1. **字段一个不多一个不少**（`AgentPanelViewProps` 由 `ComponentProps` 派生，
 *    少写或多写都会编译报错）；
 * 2. **保持每帧新建**：这里故意**不用** `useMemo` —— 字面量本来每帧新建，
 *    包一层 memo 反而会让 props 冻结在上一帧；
 * 3. **包装函数里的文案与 `runPromiseDetached` 的用法逐字保留**（用户可见）。
 */
export interface AgentPanelViewPropsInput {
  current: AgentSession | null
  openPicker: string | null
  setOpenPicker: Composer['setOpenPicker']
  sessions: Header['sessions']
  sessionActions: SessionActions
  switchTo: (session: AgentSession) => Promise<unknown>
  onOpenSettings: () => void
  onClose: () => void
  runPromiseDetached: (
    work: Promise<unknown>,
    failureMessage: string,
  ) => void
  status: Conversation['status']
  items: Conversation['items']
  visibleItems: Conversation['visibleItems']
  latestProcessIndex: Conversation['latestProcessIndex']
  streamingTextIndex: Conversation['streamingTextIndex']
  liveActivities: Conversation['liveActivities']
  liveProcess: Conversation['liveProcess']
  runTasks: Conversation['runTasks']
  copiedKey: Conversation['copiedKey']
  expanded: Conversation['expanded']
  hashOfNode: Conversation['hashOfNode']
  thumbOf: Conversation['thumbOf']
  currentTurnHasProcess: Conversation['currentTurnHasProcess']
  latestUserStartedAt: Conversation['latestUserStartedAt']
  pendingPlan: Conversation['pendingPlan']
  pendingTaskStepId: Conversation['pendingTaskStepId']
  advancingTaskPlan: Conversation['advancingTaskPlan']
  scrollRef: Conversation['scrollRef']
  showJumpToLatest: Conversation['showJumpToLatest']
  queueMenuId: Conversation['queueMenuId']
  queueMenuPosition: Conversation['queueMenuPosition']
  editingQueueId: Conversation['editingQueueId']
  editingQueueTurn: Conversation['editingQueueTurn']
  editingQueueText: Conversation['editingQueueText']
  onConversationScroll: Conversation['onConversationScroll']
  copyReply: (key: number, text: string) => Promise<void>
  retry: () => void
  toggleStep: Conversation['onToggleStep']
  advanceTaskPlan: (session: AgentSession) => Promise<unknown>
  continueTask: () => Promise<void>
  confirm: () => Promise<void>
  cancel: () => Promise<void>
  jumpToLatest: Conversation['onJumpToLatest']
  guideQueuedTurn: (turn: QueuedTurn) => Promise<void>
  removeQueued: (turnId: string) => Promise<void>
  setQueueMenuId: Conversation['onQueueMenuIdChange']
  setQueueMenuPosition: Conversation['onQueueMenuPositionChange']
  beginQueueEdit: Conversation['onBeginQueueEdit']
  commitQueueEdit: () => Promise<void>
  setEditingQueueId: Conversation['onEditingQueueIdChange']
  setEditingQueueText: Conversation['onEditingQueueTextChange']
  resumeQueue: () => Promise<void>
  deliveryMode: AgentDeliveryMode
  composerController: ComposerController
  shownModel: Composer['shownModel']
  chatModelOptions: Composer['chatModelOptions']
  modelOptionsByKind: Composer['modelOptionsByKind']
  globalImageModels: Composer['globalImageModels']
  globalVideoModels: Composer['globalVideoModels']
  mentionedModels: Composer['mentionedModels']
  graph: Composer['graph']
  libraryAssets: Composer['libraryAssets']
  allSkills: Composer['allSkills']
  skillLabel: Composer['skillLabel']
  skillFavs: Composer['skillFavs']
  skills: Composer['skills']
  thumbVersion: Composer['thumbVersion']
  fileRef: Composer['fileRef']
  skillFileRef: Composer['skillFileRef']
  skillDirRef: Composer['skillDirRef']
  send: Composer['send']
  stop: () => Promise<void>
  attachFiles: (files: FileList | null) => Promise<unknown>
  addFromLibrary: (hash: string) => Promise<unknown>
  addResearchReference: Conversation['onAddResearchReference']
  downloadResearchImage: Conversation['onDownloadResearchImage']
  sendResearchToChat: Conversation['onSendResearchToChat']
  answerQuestionCard: (text: string) => void
  pickModel: (name: string) => Promise<unknown>
  setModelKind: (
    key: 'imageModel' | 'videoModel',
    model: string,
  ) => Promise<unknown>
  setSkill: (id: string) => Promise<unknown>
  toggleSkillFavorite: (id: string) => Promise<unknown>
  openSkillLibrary: () => void
  importSkills: (files: FileList | null) => Promise<unknown>
  patchSession: Composer['patchSession']
  setAutoRun: (value: boolean) => Promise<unknown>
  channels: ChannelStore
  library: Composer['library']
}

export function useAgentPanelViewProps(
  input: AgentPanelViewPropsInput,
): ViewProps {
  const actions = input.sessionActions
  const composer = input.composerController
  const run = input.runPromiseDetached
  return {
    current: input.current,
    openPicker: input.openPicker,
    headerProps: {
      sessions: input.sessions,
      current: input.current,
      renaming: actions.renaming,
      titleDraft: actions.titleDraft,
      pickerOpen: input.openPicker === 'agent-session',
      confirmDelete: actions.confirmDelete,
      onTitleDraftChange: actions.setTitleDraft,
      onCommitRename: () => run(actions.commitRename(), '重命名失败'),
      onCancelRename: actions.cancelRename,
      onToggleSessionPicker: () =>
        input.setOpenPicker(
          input.openPicker === 'agent-session' ? null : 'agent-session',
        ),
      onClosePicker: () => input.setOpenPicker(null),
      onSwitchSession: (session) => void input.switchTo(session),
      onNewSession: () => run(actions.newSession(), '新建会话失败'),
      onStartRename: actions.startRename,
      onDeleteSession: () => run(actions.deleteSession(), '删除会话失败'),
      onOpenSettings: input.onOpenSettings,
      onClose: input.onClose,
    },
    conversationProps: {
      current: input.current,
      status: input.status,
      items: input.items,
      visibleItems: input.visibleItems,
      latestProcessIndex: input.latestProcessIndex,
      streamingTextIndex: input.streamingTextIndex,
      liveActivities: input.liveActivities,
      liveProcess: input.liveProcess,
      runTasks: input.runTasks,
      copiedKey: input.copiedKey,
      expanded: input.expanded,
      hashOfNode: input.hashOfNode,
      thumbOf: input.thumbOf,
      currentTurnHasProcess: input.currentTurnHasProcess,
      latestUserStartedAt: input.latestUserStartedAt,
      pendingPlan: input.pendingPlan,
      pendingTaskStepId: input.pendingTaskStepId,
      advancingTaskPlan: input.advancingTaskPlan,
      scrollRef: input.scrollRef,
      showJumpToLatest: input.showJumpToLatest,
      queueMenuId: input.queueMenuId,
      queueMenuPosition: input.queueMenuPosition,
      editingQueueId: input.editingQueueId,
      editingQueueTurn: input.editingQueueTurn,
      editingQueueText: input.editingQueueText,
      onConversationScroll: input.onConversationScroll,
      onCopyReply: (key, text) => void input.copyReply(key, text),
      onRetry: input.retry,
      onToggleStep: input.toggleStep,
      onAdvanceToNext: () => {
        if (!input.current) return
        run(input.advanceTaskPlan(input.current), '推进任务计划失败')
      },
      onContinueTask: () => run(input.continueTask(), '继续任务失败'),
      onConfirm: () => run(input.confirm(), '确认执行失败'),
      onCancel: () => run(input.cancel(), '取消任务失败'),
      onJumpToLatest: input.jumpToLatest,
      onGuideQueuedTurn: (turn) =>
        run(input.guideQueuedTurn(turn), '转为引导失败'),
      onRemoveQueued: (turnId) =>
        run(input.removeQueued(turnId), '移出队列失败'),
      onQueueMenuIdChange: input.setQueueMenuId,
      onQueueMenuPositionChange: input.setQueueMenuPosition,
      onBeginQueueEdit: input.beginQueueEdit,
      onCommitQueueEdit: () =>
        run(input.commitQueueEdit(), '保存队列编辑失败'),
      onEditingQueueIdChange: input.setEditingQueueId,
      onEditingQueueTextChange: input.setEditingQueueText,
      onResumeQueue: () => run(input.resumeQueue(), '恢复队列失败'),
      onAddResearchReference: input.addResearchReference,
      onDownloadResearchImage: input.downloadResearchImage,
      onSendResearchToChat: input.sendResearchToChat,
      onAnswerQuestionCard: input.answerQuestionCard,
    },
    composerProps: {
      current: input.current,
      status: input.status,
      deliveryMode: input.deliveryMode,
      draft: composer.draft,
      composerHeight: composer.composerHeight,
      composerResizing: composer.composerResizing,
      openPicker: input.openPicker,
      shownModel: input.shownModel,
      chatModelOptions: input.chatModelOptions,
      modelOptionsByKind: input.modelOptionsByKind,
      globalImageModels: input.globalImageModels,
      globalVideoModels: input.globalVideoModels,
      mentionedModels: input.mentionedModels,
      graph: input.graph,
      libraryAssets: input.libraryAssets,
      allSkills: input.allSkills,
      skillLabel: input.skillLabel,
      skillFavs: input.skillFavs,
      skills: input.skills,
      thumbVersion: input.thumbVersion,
      editorRef: composer.editorRef,
      composerRef: composer.composerRef,
      fileRef: input.fileRef,
      skillFileRef: input.skillFileRef,
      skillDirRef: input.skillDirRef,
      composerAvailableHeight: composer.composerAvailableHeight,
      beginComposerResize: composer.beginComposerResize,
      resizeComposerWithKeyboard: composer.resizeComposerWithKeyboard,
      replaceDraft: composer.replaceDraft,
      send: input.send,
      stop: () => run(input.stop(), '停止任务失败'),
      attachFiles: (files) => run(input.attachFiles(files), '添加素材失败'),
      addFromLibrary: (hash) =>
        run(input.addFromLibrary(hash), '添加素材失败'),
      pickModel: (name) => run(input.pickModel(name), '保存模型设置失败'),
      setModelKind: (kind, value) =>
        run(input.setModelKind(kind, value), '保存模型设置失败'),
      setSkill: (id) => run(input.setSkill(id), '保存技能设置失败'),
      toggleSkillFavorite: (id) =>
        run(input.toggleSkillFavorite(id), '保存技能收藏失败'),
      openSkillLibrary: input.openSkillLibrary,
      importSkills: (files) => run(input.importSkills(files), '导入技能失败'),
      patchSession: input.patchSession,
      setAutoRun: (value) =>
        run(input.setAutoRun(value), '保存自动执行设置失败'),
      insertMention: composer.insertMention,
      setDraft: composer.setDraft,
      setOpenPicker: input.setOpenPicker,
      thumbOf: input.thumbOf,
      channels: input.channels,
      library: input.library,
    },
    onDismissPicker: () => input.setOpenPicker(null),
    onDropFiles: (files) => run(input.attachFiles(files), '添加素材失败'),
  }
}
