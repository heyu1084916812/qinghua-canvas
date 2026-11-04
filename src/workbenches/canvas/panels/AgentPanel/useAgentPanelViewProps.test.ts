import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  useAgentPanelViewProps,
  type AgentPanelViewPropsInput,
} from './useAgentPanelViewProps'

function session(id = 's1'): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: '会话',
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function harness(over: Partial<AgentPanelViewPropsInput> = {}) {
  const events: string[] = []
  const run = vi.fn((_work: Promise<unknown>, message: string) => {
    events.push(message)
  })
  const input = {
    current: session('s1'),
    openPicker: null,
    setOpenPicker: vi.fn(),
    sessions: [session('s1')],
    sessionActions: {
      renaming: false,
      titleDraft: 't',
      confirmDelete: false,
      setTitleDraft: vi.fn(),
      cancelRename: vi.fn(),
      startRename: vi.fn(),
      commitRename: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
      newSession: vi.fn(async () => {}),
      resetForSessionSwitch: vi.fn(),
    },
    switchTo: vi.fn(async () => {}),
    onOpenSettings: vi.fn(),
    onClose: vi.fn(),
    runPromiseDetached: run,
    status: { kind: 'idle' },
    items: [],
    visibleItems: [],
    latestProcessIndex: -1,
    streamingTextIndex: -1,
    liveActivities: [],
    liveProcess: '',
    runTasks: [],
    copiedKey: null,
    expanded: new Set<string>(),
    hashOfNode: new Map<string, string>(),
    thumbOf: vi.fn(() => ''),
    currentTurnHasProcess: false,
    latestUserStartedAt: undefined,
    pendingPlan: null,
    pendingTaskStepId: undefined,
    advancingTaskPlan: false,
    scrollRef: { current: null },
    showJumpToLatest: false,
    queueMenuId: null,
    queueMenuPosition: null,
    editingQueueId: null,
    editingQueueTurn: null,
    editingQueueText: '',
    onConversationScroll: vi.fn(),
    copyReply: vi.fn(async () => {}),
    retry: vi.fn(),
    toggleStep: vi.fn(),
    advanceTaskPlan: vi.fn(async () => true),
    continueTask: vi.fn(async () => {}),
    confirm: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    jumpToLatest: vi.fn(),
    guideQueuedTurn: vi.fn(async () => {}),
    removeQueued: vi.fn(async () => {}),
    setQueueMenuId: vi.fn(),
    setQueueMenuPosition: vi.fn(),
    beginQueueEdit: vi.fn(),
    commitQueueEdit: vi.fn(async () => {}),
    setEditingQueueId: vi.fn(),
    setEditingQueueText: vi.fn(),
    resumeQueue: vi.fn(async () => {}),
    deliveryMode: 'steer',
    composerController: {
      draft: 'hi',
      composerHeight: 120,
      composerResizing: false,
      composerAvailableHeight: () => 200,
      beginComposerResize: vi.fn(),
      resizeComposerWithKeyboard: vi.fn(),
      replaceDraft: vi.fn(),
      editorRef: { current: null },
      composerRef: { current: null },
      insertMention: vi.fn(),
      setDraft: vi.fn(),
      setOpenPicker: vi.fn(),
    },
    shownModel: 'GPT-6',
    chatModelOptions: ['GPT-6'],
    modelOptionsByKind: { image: [], video: [] },
    globalImageModels: [],
    globalVideoModels: [],
    mentionedModels: [],
    graph: { nodes: [], edges: [] },
    libraryAssets: [],
    allSkills: [],
    skillLabel: vi.fn(() => ''),
    skillFavs: [],
    skills: [],
    thumbVersion: 0,
    fileRef: { current: null },
    skillFileRef: { current: null },
    skillDirRef: { current: null },
    send: vi.fn(),
    stop: vi.fn(async () => {}),
    attachFiles: vi.fn(async () => {}),
    addFromLibrary: vi.fn(async () => {}),
    pickModel: vi.fn(async () => {}),
    setModelKind: vi.fn(async () => {}),
    setSkill: vi.fn(async () => {}),
    toggleSkillFavorite: vi.fn(async () => {}),
    openSkillLibrary: vi.fn(),
    importSkills: vi.fn(async () => {}),
    patchSession: vi.fn(),
    setAutoRun: vi.fn(async () => {}),
    channels: {} as never,
    library: {} as never,
    ...over,
  } as unknown as AgentPanelViewPropsInput
  return { input, run, events }
}

describe('useAgentPanelViewProps / 顶层与 headerProps', () => {
  it('顶层三件套原样；onDismissPicker 关浮层', () => {
    const h = harness({ openPicker: 'agent-session' })
    const props = useAgentPanelViewProps(h.input)

    expect(props.current).toBe(h.input.current)
    expect(props.openPicker).toBe('agent-session')
    props.onDismissPicker()
    expect(h.input.setOpenPicker).toHaveBeenCalledWith(null)
  })

  it('header：pickerOpen 判定 + 动作全部走 runPromiseDetached 与原文案', () => {
    const h = harness({ openPicker: 'agent-session' })
    const header = useAgentPanelViewProps(h.input).headerProps

    expect(header.pickerOpen).toBe(true)
    expect(header.sessions).toBe(h.input.sessions)
    expect(header.renaming).toBe(false)
    expect(header.titleDraft).toBe('t')

    header.onCommitRename!()
    header.onNewSession!()
    header.onDeleteSession!()
    expect(h.events).toEqual([
      '重命名失败',
      '新建会话失败',
      '删除会话失败',
    ])

    header.onSwitchSession(session('s2'))
    expect(h.input.switchTo).toHaveBeenCalledWith(session('s2'))
    header.onClosePicker!()
    expect(h.input.setOpenPicker).toHaveBeenCalledWith(null)
  })

  it('header：开着选择器再点就是关，关着就是开', () => {
    const open = harness({ openPicker: 'agent-session' })
    useAgentPanelViewProps(open.input).headerProps.onToggleSessionPicker!()
    expect(open.input.setOpenPicker).toHaveBeenCalledWith(null)

    const closed = harness({ openPicker: null })
    useAgentPanelViewProps(
      closed.input,
    ).headerProps.onToggleSessionPicker!()
    expect(closed.input.setOpenPicker).toHaveBeenCalledWith('agent-session')
  })
})

describe('useAgentPanelViewProps / conversationProps', () => {
  it('派生值原样透传，不重新计算', () => {
    const h = harness()
    const conv = useAgentPanelViewProps(h.input).conversationProps

    expect(conv.items).toBe(h.input.items)
    expect(conv.visibleItems).toBe(h.input.visibleItems)
    expect(conv.hashOfNode).toBe(h.input.hashOfNode)
    expect(conv.advancingTaskPlan).toBe(false)
    expect(conv.latestProcessIndex).toBe(-1)
  })

  it('onAdvanceToNext：无当前会话不调；有则走 advanceTaskPlan', () => {
    const none = harness({ current: null })
    useAgentPanelViewProps(none.input).conversationProps.onAdvanceToNext()
    expect(none.input.advanceTaskPlan).not.toHaveBeenCalled()

    const h = harness()
    useAgentPanelViewProps(h.input).conversationProps.onAdvanceToNext()
    expect(h.input.advanceTaskPlan).toHaveBeenCalledWith(h.input.current)
    expect(h.events).toEqual(['推进任务计划失败'])
  })

  it('其余动作的文案逐条保留', () => {
    const h = harness()
    const conv = useAgentPanelViewProps(h.input).conversationProps

    conv.onContinueTask()
    conv.onConfirm()
    conv.onCancel()
    conv.onGuideQueuedTurn!({ id: 'q1' } as never)
    conv.onRemoveQueued!('q1')
    conv.onCommitQueueEdit()
    conv.onResumeQueue()

    expect(h.events).toEqual([
      '继续任务失败',
      '确认执行失败',
      '取消任务失败',
      '转为引导失败',
      '移出队列失败',
      '保存队列编辑失败',
      '恢复队列失败',
    ])
  })
})

describe('useAgentPanelViewProps / composerProps', () => {
  it('composer 控制器字段映射正确', () => {
    const h = harness()
    const composer = useAgentPanelViewProps(h.input).composerProps

    expect(composer.draft).toBe('hi')
    expect(composer.composerHeight).toBe(120)
    expect(composer.editorRef).toBe(h.input.composerController.editorRef)
    expect(composer.setDraft).toBe(h.input.composerController.setDraft)
    expect(composer.shownModel).toBe('GPT-6')
    expect(composer.deliveryMode).toBe('steer')
  })

  it('stop / 素材 / 模型 / 技能 的包装与文案逐条保留', () => {
    const h = harness()
    const composer = useAgentPanelViewProps(h.input).composerProps

    composer.stop()
    composer.attachFiles!(null)
    composer.addFromLibrary!('h1')
    composer.pickModel!('m')
    composer.setModelKind!('imageModel', 'm')
    composer.setSkill!('sk')
    composer.toggleSkillFavorite!('sk')
    composer.importSkills!(null)
    composer.setAutoRun!(true)

    expect(h.events).toEqual([
      '停止任务失败',
      '添加素材失败',
      '添加素材失败',
      '保存模型设置失败',
      '保存模型设置失败',
      '保存技能设置失败',
      '保存技能收藏失败',
      '导入技能失败',
      '保存自动执行设置失败',
    ])
    // 参数顺序不能反：key 在前、model 在后
    expect(h.input.setModelKind).toHaveBeenCalledWith('imageModel', 'm')
  })
})

describe('useAgentPanelViewProps / 字段清单对账', () => {
  it('三个包的键集合与拆分前逐字一致（多一个少一个都红）', () => {
    const props = useAgentPanelViewProps(harness().input)

    expect(Object.keys(props).sort()).toEqual([
      'composerProps',
      'conversationProps',
      'current',
      'headerProps',
      'onDismissPicker',
      'onDropFiles',
      'openPicker',
    ])
    expect(Object.keys(props.headerProps).sort()).toEqual([
      'confirmDelete',
      'current',
      'onCancelRename',
      'onClose',
      'onClosePicker',
      'onCommitRename',
      'onDeleteSession',
      'onNewSession',
      'onOpenSettings',
      'onStartRename',
      'onSwitchSession',
      'onTitleDraftChange',
      'onToggleSessionPicker',
      'pickerOpen',
      'renaming',
      'sessions',
      'titleDraft',
    ])
    expect(Object.keys(props.conversationProps).sort()).toEqual([
      'advancingTaskPlan',
      'copiedKey',
      'current',
      'currentTurnHasProcess',
      'editingQueueId',
      'editingQueueText',
      'editingQueueTurn',
      'expanded',
      'hashOfNode',
      'items',
      'latestProcessIndex',
      'latestUserStartedAt',
      'liveActivities',
      'liveProcess',
      'onAdvanceToNext',
      'onBeginQueueEdit',
      'onCancel',
      'onCommitQueueEdit',
      'onConfirm',
      'onContinueTask',
      'onConversationScroll',
      'onCopyReply',
      'onEditingQueueIdChange',
      'onEditingQueueTextChange',
      'onGuideQueuedTurn',
      'onJumpToLatest',
      'onQueueMenuIdChange',
      'onQueueMenuPositionChange',
      'onRemoveQueued',
      'onResumeQueue',
      'onRetry',
      'onToggleStep',
      'pendingPlan',
      'pendingTaskStepId',
      'queueMenuId',
      'queueMenuPosition',
      'runTasks',
      'scrollRef',
      'showJumpToLatest',
      'status',
      'streamingTextIndex',
      'thumbOf',
      'visibleItems',
    ])
    expect(Object.keys(props.composerProps).sort()).toEqual([
      'addFromLibrary',
      'allSkills',
      'attachFiles',
      'beginComposerResize',
      'channels',
      'chatModelOptions',
      'composerAvailableHeight',
      'composerHeight',
      'composerRef',
      'composerResizing',
      'current',
      'deliveryMode',
      'draft',
      'editorRef',
      'fileRef',
      'globalImageModels',
      'globalVideoModels',
      'graph',
      'importSkills',
      'insertMention',
      'library',
      'libraryAssets',
      'mentionedModels',
      'modelOptionsByKind',
      'openPicker',
      'openSkillLibrary',
      'patchSession',
      'pickModel',
      'replaceDraft',
      'resizeComposerWithKeyboard',
      'send',
      'setAutoRun',
      'setDraft',
      'setModelKind',
      'setOpenPicker',
      'setSkill',
      'shownModel',
      'skillDirRef',
      'skillFavs',
      'skillFileRef',
      'skillLabel',
      'skills',
      'status',
      'stop',
      'thumbOf',
      'thumbVersion',
      'toggleSkillFavorite',
    ])
  })
})
