import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import type { DeclarativeProtocolPackage } from '../../domain/project/protocolRecipe'
import {
  type CategoryFilter,
} from '../../domain/project/modelSelection'
import { drawerTabFocus } from './settingsPageOverlayRules'
import {
  ROUTE_PLAN_STRATEGIES,
  type RoutePlanStrategy,
} from '../../domain/project/routePlan'
import {
  measureProfileDrawerBounds,
  type ChannelFilterKey,
  type MapFilterKey,
  type PresetModel,
  type PresetVendor,
} from './settingsPageConstants'
import { isBuiltinChannelId } from '../../domain/project/builtinChannels'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  createChannelActions,
  type ChannelActionPorts,
  type ChannelActionState,
  type ChannelFormState,
} from './settingsPage/channelActionCoordinator'
import {
  createModelMappingActions,
  type ModelMappingPorts,
} from './settingsPage/modelMappingActionCoordinator'
import {
  createProtocolActions,
  type ProtocolActionPorts,
  type ProtocolActionState,
} from './settingsPage/protocolActionCoordinator'
import * as actionDelegates from './settingsPage/settingsActionDelegates'
import * as channelPresentation from './settingsPage/settingsChannelPresentation'
import * as interactionLifecycle from './settingsPage/settingsInteractionLifecycle'
import * as routingInteractions from './settingsPage/settingsRoutingActions'
import * as statusPresentation from './settingsPage/settingsStatusPresentation'
import { settingsPageStyles as styles } from './settingsPage/settingsPageStyles'
import { SettingsGlobalRouteView } from './settingsPage/SettingsGlobalRouteView'
import { SettingsChannelSidebarView } from './settingsPage/SettingsChannelSidebarView'
import { SettingsProviderHeaderView } from './settingsPage/SettingsProviderHeaderView'
import { SettingsConnectionView } from './settingsPage/SettingsConnectionView'
import { SettingsModelsView } from './settingsPage/SettingsModelsView'
import { SettingsChannelRouteView } from './settingsPage/SettingsChannelRouteView'
import { SettingsProfileDrawerView } from './settingsPage/SettingsProfileDrawerView'
import { SettingsChannelContextMenuView } from './settingsPage/SettingsChannelContextMenuView'

type SettingsSetter<T> = Dispatch<SetStateAction<T>>

const settingsTimerPorts: interactionLifecycle.TimerPorts = {
  setTimeout: (handler, delay) => window.setTimeout(handler, delay),
  clearTimeout: (timer) => window.clearTimeout(timer),
}

function listenPointerDown(listener: (target: unknown) => void, capture: boolean): () => void {
  const handler = (event: PointerEvent) => listener(event.target)
  document.addEventListener('pointerdown', handler, capture)
  return () => document.removeEventListener('pointerdown', handler, capture)
}

function listenKeyDown(
  listener: (event: { key: string; shiftKey: boolean; preventDefault(): void }) => void,
): () => void {
  const handler = (event: KeyboardEvent) => listener(event)
  document.addEventListener('keydown', handler)
  return () => document.removeEventListener('keydown', handler)
}

function listenResize(listener: () => void): () => void {
  window.addEventListener('resize', listener)
  return () => window.removeEventListener('resize', listener)
}

function listenScroll(listener: () => void): () => void {
  window.addEventListener('scroll', listener, true)
  return () => window.removeEventListener('scroll', listener, true)
}

function patchFormSetter(
  setName: SettingsSetter<string>,
  setProtocol: SettingsSetter<string>,
  setBaseUrl: SettingsSetter<string>,
  setEnabled: SettingsSetter<boolean>,
): (next: Partial<ChannelFormState>) => void {
  return (next) => {
    if (next.name !== undefined) setName(next.name)
    if (next.protocol !== undefined) setProtocol(next.protocol)
    if (next.baseUrl !== undefined) setBaseUrl(next.baseUrl)
    if (next.enabled !== undefined) setEnabled(next.enabled)
  }
}

function profileFocusSetter(ref: { current: HTMLElement | null }): (value: HTMLElement | null) => void {
  return (value) => {
    ref.current = value
  }
}

/**
 * 模型映射区的**五个筛选**（用户 2026-10-08 第 1 条：「图一这个模型映射的地方换成五个筛选吧，
 * 目前是生图，对话，视频放在一起的，加上音频，3d」）。
 *
 * 与上一版（三组平铺、一屏 15 行）的区别：一次只显示**一类**，行数从 15 压到 7 行以内。
 *
 * ⚠️ 后两档（音频 / 3D）是**预留位**：前端固定清单 `PRESET_MODELS` 目前只有
 * `image | chat | video` 三种类别，所以点开会看到"这一类还没有模型"——
 * 等清单里加上音频 / 3D 的显示名，这里**自动**就有内容（不必回来改代码）。
 * 这也是为什么筛选键用 `string` 而不是去扩 `ModelCapability['category']`：
 * 扩那个联合要动渠道拉取 / 选路 / 画布面板一整条链，而清单里现在并没有那两类模型。
 */
export function SettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const channels = useChannels()
  const channelsList = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().channels,
    () => channels.getState().channels,
  )
  const customModels = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().customModels,
    () => channels.getState().customModels,
  )
  const uncommonModelIds = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().uncommonModelIds,
    () => channels.getState().uncommonModelIds,
  )
  const allGlobalModels = useMemo(
    () =>
      (['image', 'chat', 'video', 'audio'] as const).flatMap((category) =>
        channels.globalModelsOf(category, true),
      ),
    [channels, customModels, uncommonModelIds],
  )
  const verify = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().verify,
    () => channels.getState().verify,
  )
  const modelsResult = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().models,
    () => channels.getState().models,
  )
  const detect = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().detect,
    () => channels.getState().detect,
  )
  const hiddenBuiltinProtocolIds = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().hiddenBuiltinProtocolIds,
    () => channels.getState().hiddenBuiltinProtocolIds,
  )
  const hiddenBuiltinProtocolSet = useMemo(
    () => new Set(hiddenBuiltinProtocolIds),
    [hiddenBuiltinProtocolIds],
  )
  const referencedProtocolIds = useMemo(
    () => new Set(channelsList.map((channel) => channel.protocol)),
    [channelsList],
  )
  /** 全局路由策略：与选中的渠道无关，跨三个工作台共用。 */
  const routingPolicy = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().routingPolicy,
    () => channels.getState().routingPolicy,
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [channelMenu, setChannelMenu] = useState<{
    channelId: string
    x: number
    y: number
  } | null>(null)
  const [menuConfirmDelete, setMenuConfirmDelete] = useState(false)
  const channelMenuRef = useRef<HTMLDivElement | null>(null)
  const [channelSearch, setChannelSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<ChannelFilterKey>('all')
  const [routingScopeOpen, setRoutingScopeOpen] = useState(false)
  const [expandedRoutingChannels, setExpandedRoutingChannels] = useState<Set<string>>(
    () => new Set(),
  )
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false)
  const [profileDrawerBounds, setProfileDrawerBounds] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [profileIconDraft, setProfileIconDraft] = useState<string | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const profileFileRef = useRef<HTMLInputElement | null>(null)
  const profileReturnFocusRef = useRef<HTMLElement | null>(null)
  const [name, setName] = useState('')
  const [protocol, setProtocol] = useState('mock')
  const [baseUrl, setBaseUrl] = useState('')
  const [enabled, setEnabled] = useState(false)
  /** 令牌的输入 / 显示 / 已存状态都在 `ChannelTokenField` 里（一行一份，见上面的组件） */
  const [busy, setBusy] = useState(false)
  /**
   * 图标那一行的**结果话术**（对账 #396）：抓成功说抓到哪儿了，失败说为什么、
   * 下一步做什么。失败时不弹窗 —— 用户就在这一行上，话就该留在这儿。
   */
  /**
   * 上一次「验证地址 / 拉取模型 / 验证协议」是对**哪条渠道、哪个协议**做的。
   * 状态行据此显示协议名——否则「✓ 验证通过」在 mock 下与在真实中转下
   * 长得一模一样，用户根本无法判断这次到底出没出网（这正是把他坑住的那句话）。
   */
  const [verifiedFor, setVerifiedFor] = useState<{
    channelId: string
    protocol: string
    source: 'verify' | 'models' | 'detect'
  } | null>(null)

  // —— 选择模型面板（§7.4）——
  // 面板是**草稿态**：勾选先记在本地，点「应用到模型列表」才落库。
  // 这样中途取消（或点遮罩外）不会把半成品状态写进渠道——与画布「编辑中不落库」同一口径。
  const [panelOpen, setPanelOpen] = useState(false)
  const [draftChecked, setDraftChecked] = useState<ReadonlySet<string>>(new Set())
  const [draftCategory, setDraftCategory] = useState<CategoryFilter>('all')
  const [draftKeyword, setDraftKeyword] = useState('')

  /** 正在被拖动的渠道 id（§7.2 拖动排序） */
  const [dragId, setDragId] = useState<string | null>(null)
  /**
   * 映射表的草稿（M7-2）：`逻辑名 → 输入框里的值`。
   *
   * 为什么是草稿而不是「改一个存一个」：映射是**按渠道**的一整张表，
   * 逐条落库会让「改到一半」的状态被持久化（用户还没决定，库里已经变了）。
   * 与本页既有的渠道表单、模型选择面板同一口径（中途反悔不该留下半份改动）。
   * 切渠道时清空，避免把 A 站的上游 ID 带到 B 站。
   */
  const [mapDrafts, setMapDrafts] = useState<Record<string, string>>({})
  const mapSaveTimersRef = useRef(new Map<string, number>())
  const [mapSaveNotice, setMapSaveNotice] = useState<{
    id: string
    tone: 'ok' | 'error'
    text: string
  } | null>(null)
  const [modelAddOpen, setModelAddOpen] = useState(false)
  const [newModelName, setNewModelName] = useState('')
  const [newModelCategory, setNewModelCategory] =
    useState<PresetModel['category']>('image')
  const [newModelVendor, setNewModelVendor] = useState<PresetVendor>('openai')
  const [showUncommonModels, setShowUncommonModels] = useState(false)
  const [mapTests, setMapTests] = useState<
    Record<string, { status: 'checking' | 'ok' | 'missing' | 'error'; message: string }>
  >({})

  /**
   * 映射区当前看的**哪一类**（用户 2026-10-08 第 1 条：五个筛选）。
   * 默认「生图」——绝大多数人第一条渠道就是为了出图。
   * 刻意**不随切渠道复位**：用户在比对两条渠道的同一类映射时，来回切渠道不必重新点筛选项。
   */
  const [mapCategory, setMapCategory] = useState<MapFilterKey>('image')

  /**
   * 协议目录版本号。`protocolCatalog()` 每次返回**新对象**，但 useSyncExternalStore
   * 只在 store 快照变化时重渲染；自建协议增删后靠这个计数把目录重算一遍，
   * 让新协议立刻出现在下拉里（不必刷新页面）。
   */
  const [catalogVersion, setCatalogVersion] = useState(0)
  const catalog = useMemo(() => channels.protocolCatalog(), [channels, catalogVersion])
  const platform = usePlatform()
  /** 桌面壳里才有本机命令（对账 #308）：状态行文案据此区分"本机命令"与"地址" */
  const hasLocalCli = platform.cli != null
  const {
    candidates: routingCandidates, groups: routingChannelGroups, selectedKeys: selectedRoutingCandidateKeys,
  } = useMemo(
    () => routingInteractions.routingPresentationFor(
      channelsList,
      hasLocalCli,
      routingPolicy.allowedCandidates,
    ),
    [channelsList, hasLocalCli, routingPolicy.allowedCandidates],
  )

  const routingActions = routingInteractions.createRoutingActions(
    routingCandidates,
    selectedRoutingCandidateKeys,
    (next) => void channels.setRoutingPolicy(next),
  )
  const toggleRoutingCandidate = routingActions.toggleCandidate
  const toggleRoutingChannel = routingActions.toggleChannel

  const toggleRoutingChannelExpanded = (channelId: string) => {
    setExpandedRoutingChannels((current) =>
      routingInteractions.toggleRoutingChannelExpanded(current, channelId),
    )
  }
  /** 抓站点图标要原生 HTTP（对账 #396）：浏览器里跨域读不到，按钮据此如实禁用 */
  /** 下拉里的全部协议（含 pending：它们显示为“待支持”且不可选，见协议区渲染） */
  const {
    note: selectedProtocolNote = '', credentials: credentialSlots = [], docUrl = '',
  } = channelPresentation.protocolUsageFor(protocol, catalog)
  /**
   * 旧协议（`openai-images` / `openai-chat`）**只在当前渠道本身就是它时才出现**（用户 2026-09-29「不要重复的东西」）。
   *
   * 这两个 id 不能从目录里删：老渠道存的就是它们，删了会变成「未知协议」、
   * 适配器也认不出族（`registry.ts` 的 `LEGACY_FAMILY` 正是靠它们兜底）。
   * 但新渠道不该再选到 —— 它们与「OpenAI 兼容」是同一套适配器，只是能力被写死成单项。
   */
  const {
    visible: visibleProtocolOptions,
    pending: pendingProtocols,
  } = channelPresentation.protocolOptionsFor({
    catalog,
    currentProtocol: protocol,
    hiddenBuiltinProtocolIds: hiddenBuiltinProtocolSet,
  })

  // —— 添加自定义协议（用户 2026-09-28）：只开放 OpenAI 兼容族的对话 / 生图声明 ——
  const [newProtoOpen, setNewProtoOpen] = useState(false)
  const [npImportText, setNpImportText] = useState('')
  const [npImported, setNpImported] = useState<DeclarativeProtocolPackage | null>(null)
  const [npError, setNpError] = useState('')
  const [npNotice, setNpNotice] = useState('')
  const [protoRemoveError, setProtoRemoveError] = useState('')
  const [protoManageNotice, setProtoManageNotice] = useState('')

  useEffect(() => {
    void channels.load()
  }, [channels])

  useEffect(
    () =>
      interactionLifecycle.clearTimedNotice(
        Boolean(protoManageNotice),
        2600,
        () => setProtoManageNotice(''),
        settingsTimerPorts,
      ),
    [protoManageNotice],
  )

  const selected = channelsList.find((channel) => channel.id === selectedId) ?? null
  const visibleChannels = useMemo(
    () => channelPresentation.visibleChannelsFor(
      channelsList,
      channelFilter,
      channelSearch,
      catalog,
    ),
    [catalog, channelFilter, channelSearch, channelsList],
  )
  const selectedKeyGroups = useMemo(() => channelPresentation.credentialGroupsFor(selected), [selected])
  const activeGroup = channelPresentation.activeCredentialGroupFor(selectedKeyGroups, activeGroupId)
  const activeModels = activeGroup?.models ?? selected?.models ?? []
  const activeModelCache = activeGroup?.modelCache ?? selected?.modelCache ?? []

  // 选中变化 → 同步表单。依赖刻意只放 selectedId；store 回写对象不能重置表单草稿。
  useEffect(() => {
    const ch = channels.getState().channels.find((c) => c.id === selectedId) ?? null
    interactionLifecycle.applySelectedChannelChange(ch, {
      resetPanel: () => setPanelOpen(false),
      resetChannelMenu: () => {
        setChannelMenu(null)
        setMenuConfirmDelete(false)
      },
      resetMapDrafts: () => setMapDrafts({}),
      resetMapSaveNotice: () => setMapSaveNotice(null),
      resetMapTests: () => setMapTests({}),
      clearMapSaveTimers: () =>
        interactionLifecycle.clearMapSaveTimers(
          mapSaveTimersRef.current,
          (timer) => window.clearTimeout(timer),
        ),
      setActiveGroupId,
      setForm: patchFormSetter(setName, setProtocol, setBaseUrl, setEnabled),
    })
  }, [selectedId, channels])

  useEffect(
    () =>
      interactionLifecycle.watchChannelMenu(Boolean(channelMenu), {
        ...settingsTimerPorts,
        onPointerDown: listenPointerDown,
        onKeyDown: listenKeyDown,
        onResize: listenResize,
        onScroll: listenScroll,
        close: () => {
          setChannelMenu(null)
          setMenuConfirmDelete(false)
        },
        focusFirstButton: () =>
          channelMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(),
        isInsideMenu: (target) =>
          target instanceof Element && Boolean(target.closest('[data-channel-context-menu]')),
      }),
    [channelMenu, menuConfirmDelete],
  )

  useEffect(
    () =>
      interactionLifecycle.watchProfileDrawer(profileDrawerOpen, {
        ...settingsTimerPorts,
        onKeyDown: listenKeyDown,
        onResize: listenResize,
        syncBounds: () => setProfileDrawerBounds(measureProfileDrawerBounds()),
        focusNameInput: () =>
          document.querySelector<HTMLInputElement>('[data-settings-profile-name]')?.focus(),
        close: () => setProfileDrawerOpen(false),
        trapTabFocus: (event) =>
          drawerTabFocus(
            event as KeyboardEvent,
            document.querySelector<HTMLElement>('[data-settings-profile-drawer]'),
          ),
        restoreFocus: () => profileReturnFocusRef.current?.focus(),
      }),
    [profileDrawerOpen],
  )

  useEffect(
    () =>
      interactionLifecycle.clearTimedNotice(
        mapSaveNotice?.tone === 'ok',
        1200,
        () => setMapSaveNotice(null),
        settingsTimerPorts,
      ),
    [mapSaveNotice],
  )

  useEffect(
    () => () =>
      interactionLifecycle.clearMapSaveTimers(
        mapSaveTimersRef.current,
        (timer) => window.clearTimeout(timer),
      ),
    [],
  )

  const channelPorts: ChannelActionPorts = {
    channels,
    getChannels: () => channels.getState().channels,
    setSelectedId,
    setActiveGroupId,
    setChannelFilter,
    setChannelSearch,
    setForm: patchFormSetter(setName, setProtocol, setBaseUrl, setEnabled),
    setBusy,
    setVerifiedFor,
    setChannelMenu,
    setMenuConfirmDelete,
    setProfileDrawerBounds,
    setProfileNameDraft,
    setProfileIconDraft,
    setProfileDrawerOpen,
    setProfileSaving,
    profileReturnFocus: profileFocusSetter(profileReturnFocusRef),
    setPanelOpen,
    setDraftChecked,
    setDraftCategory,
    setDraftKeyword,
    setDragId,
    setNewModelName,
    setModelAddOpen,
    setMapCategory,
    alert: (message) => window.alert(message),
    confirm: (message) => window.confirm(message),
  }
  const channelState = (): ChannelActionState => ({
    selectedId,
    form: { name, protocol, baseUrl, enabled },
    selected,
    selectedKeyGroups,
    activeGroup,
    activeModels,
    activeModelCache,
    channelList: channelsList,
    catalog,
    hiddenBuiltinProtocolIds: hiddenBuiltinProtocolSet,
    draftChecked,
    dragId,
    profileNameDraft,
    profileIconDraft,
    newModelName,
    newModelCategory,
    newModelVendor,
    platform,
  })
  const channelActions = createChannelActions(channelPorts)
  const mappingPorts: ModelMappingPorts = {
    channels,
    selectedId: () => selectedId,
    activeGroupId: () => activeGroup?.id,
    timers: mapSaveTimersRef.current,
    setMapDrafts,
    setMapSaveNotice,
    setMapTests,
    setTimeout: (handler, delay) => window.setTimeout(handler, delay),
    clearTimeout: (timer) => window.clearTimeout(timer),
  }
  const mappingActions = createModelMappingActions(mappingPorts)
  const protocolPorts: ProtocolActionPorts = {
    channels,
    platform,
    setCatalogVersion,
    setProtocol,
    setBaseUrl,
    setNpImportText,
    setNpImported,
    setNpError,
    setNpNotice,
    setProtoRemoveError,
    setProtoManageNotice,
    setNewProtoOpen,
  }
  const protocolState = (): ProtocolActionState => ({
    selectedId,
    protocol,
    baseUrl,
    catalog,
    npImportText,
    npImported,
    newProtoOpen,
  })
  const protocolActions = createProtocolActions(protocolPorts)

  const {
    handleCreate, handleEnableChange, handleProfileIconFile, saveProfileDrawer,
    persistForm, handleVerify, handleDetect, handleRefresh,
    openChannelMenu, openChannelMenuFromButton, editChannel, handleRemove,
    handleAddKeyGroup, handleRemoveKeyGroup, flushModelMapping, scheduleModelMapping,
    testModelMapping, handleAddGlobalModel, handleRemoveGlobalModel, openPanel,
    toggleDraft, applyDraft, dropSelectedModel, dropOnChannel,
    handleProtocolChange, checkImportedProtocol, handleImportProtocolFile,
    handleSaveImportedProtocol, downloadProtocolTemplate, downloadProtocol,
    toggleNewProtocol, handleRemoveProtocol, handleRestoreBuiltinProtocols,
  } = actionDelegates.createSettingsActionDelegates({
    channelActions,
    mappingActions,
    protocolActions,
    channelState,
    protocolState,
  })
  const draftList = channelPresentation.draftModelsFor(
    selected,
    activeModelCache,
    draftCategory,
    draftKeyword,
  )
  const selectedGroups = channelPresentation.selectedModelGroupsFor(activeModels)
  const action = verifiedFor?.channelId === selectedId ? verifiedFor.source : null

  const {
    line: statusLine,
    tone: statusTone,
    showMockNote,
  } = statusPresentation.settingsStatusPresentation({
    action,
    verifiedFor,
    verify,
    modelsResult,
    detect,
    catalog,
    hasLocalCli,
  })

  // mock 提示只在**真的拿 mock 验了地址**时出现（探测的候选表不含 mock，故不受其影响）。
  /**
   * 这条协议**要几把钥匙**（用户第 22 批 #358）：协议目录声明（RunningHub 两把），
   * 没声明的协议回落到"一把"，见下面令牌区的渲染。
   */
  /**
   * 这一条协议官网的**取令牌页**（用户第 19 批 #2：「需要有点击就跳转到官网，获取令牌的选项」）。
   * 地址来自协议目录的 `docUrl`（唯一来源）—— 没写就**不出现**这个链接，不猜地址。
   */
  /**
   * 选中的是不是**内置渠道**（用户第 20 批：三条常驻渠道「固定字段」= 名称 + 协议）。
   * 界面据此禁用名称 / 协议与删除；命令层（仓储）另有一道同样的拦截，
   * 所以"禁不掉"这件事不靠界面自觉。
   */
  const builtinSelected = !!selectedId && isBuiltinChannelId(selectedId)
  const {
    channel: menuChannel,
    builtin: menuBuiltin,
    width: menuWidth,
    left: menuLeft,
    top: menuTop,
  } = channelPresentation.channelMenuPresentationFor(
    channelsList,
    channelMenu,
    { width: window.innerWidth, height: window.innerHeight },
    menuConfirmDelete,
  )
  return (
    <div className={styles.page}>
      {/*
        ⛔ 页内标题「后台设置」与左侧二级菜单**已删除**（用户 2026-09-27 第 9 轮）：
        「后台设置这几个词贴边了，不需要了，后台设置工作区里面左边的几个菜单也不需要了」。

        两条理由：
        ① 身份与导航**已由应用壳侧栏表达**（它那一项就叫「渠道配置」），
           页内再放标题与菜单就是同一个事实的第二份说法；
        ② 三个菜单项里，功能预设词与技能库已按 §7A 迁去技能库一级页，
           只剩「渠道」一项 —— 一个只有单个选项的菜单没有任何导航价值。

        于是这个页面现在就是**渠道配置本身**，从内容直接开始。
      */}
      {(
      <div className={embedded ? styles.layoutEmbedded : styles.layout} data-settings-card>
        <SettingsGlobalRouteView
          strategy={routingPolicy.strategy}
          strategyOptions={ROUTE_PLAN_STRATEGIES.map((strategy) => ({
            value: strategy.value,
            label: strategy.label,
            hint: strategy.hint,
          }))}
          maxAttempts={routingPolicy.maxAttempts}
          scopeOpen={routingScopeOpen}
          allowedCandidatesCount={routingPolicy.allowedCandidates.length}
          routingCandidatesCount={routingCandidates.length}
          selectedRoutingCandidateKeys={selectedRoutingCandidateKeys}
          routingChannelGroups={routingChannelGroups}
          expandedRoutingChannels={expandedRoutingChannels}
          onStrategyChange={(value) =>
            void channels.setRoutingPolicy({
              strategy: value as RoutePlanStrategy,
            })
          }
          onMaxAttemptsChange={(value) =>
            void channels.setRoutingPolicy({ maxAttempts: Number(value) })
          }
          onToggleScope={() => setRoutingScopeOpen((open) => !open)}
          onResetScope={() =>
            void channels.setRoutingPolicy({ allowedCandidates: [] })
          }
          onToggleRoutingChannel={toggleRoutingChannel}
          onToggleRoutingChannelExpanded={toggleRoutingChannelExpanded}
          onToggleRoutingCandidate={toggleRoutingCandidate}
        />

        <div className={styles.workarea} data-settings-workarea>
          <SettingsChannelSidebarView
            catalog={catalog}
            channels={channelsList}
            visibleChannels={visibleChannels}
            selectedId={selectedId}
            channelSearch={channelSearch}
            channelFilter={channelFilter}
            dragId={dragId}
            openChannelId={channelMenu?.channelId ?? null}
            onSearchChange={setChannelSearch}
            onFilterChange={setChannelFilter}
            onSelectChannel={setSelectedId}
            onOpenChannelMenu={openChannelMenu}
            onOpenChannelMenuFromButton={openChannelMenuFromButton}
            onDragStart={setDragId}
            onDragEnd={() => setDragId(null)}
            onDropOnChannel={(channelId) => void dropOnChannel(channelId)}
            onCreate={() => void handleCreate()}
          />

        <section className={styles.editor} data-settings-editor>
          {!selected ? (
            <div className={styles.placeholder}>从左侧选择，或新增一个模型服务</div>
          ) : (
            <div className={styles.form} data-settings-form>
              <SettingsProviderHeaderView
                channelId={selected.id}
                protocol={protocol}
                icon={selected.icon}
                name={name}
                ariaName={selected.name}
                enabled={enabled}
                onEditProfile={editChannel}
                onEnabledChange={(next) => void handleEnableChange(next)}
              />
              <SettingsConnectionView
                channels={channels}
                selected={selected}
                baseUrl={baseUrl}
                busy={busy}
                activeGroup={activeGroup}
                selectedKeyGroups={selectedKeyGroups}
                credentialSlots={credentialSlots}
                docUrl={docUrl}
                protocol={protocol}
                builtinSelected={builtinSelected}
                visibleProtocolOptions={visibleProtocolOptions}
                pendingProtocols={pendingProtocols}
                referencedProtocolIds={referencedProtocolIds}
                statusLine={statusLine}
                statusTone={statusTone}
                showMockNote={showMockNote}
                selectedProtocolNote={selectedProtocolNote}
                newProtoOpen={newProtoOpen}
                hiddenBuiltinProtocolCount={hiddenBuiltinProtocolIds.length}
                npNotice={npNotice}
                protoManageNotice={protoManageNotice}
                protoRemoveError={protoRemoveError}
                npImportText={npImportText}
                npImported={npImported}
                npError={npError}
                onBaseUrlChange={setBaseUrl}
                onPersistForm={persistForm}
                onAddKeyGroup={handleAddKeyGroup}
                onRemoveKeyGroup={handleRemoveKeyGroup}
                onActiveGroupChange={setActiveGroupId}
                onRenameKeyGroup={(groupId, nextName) =>
                  void channels.renameCredentialGroup(
                    selected.id,
                    groupId,
                    nextName,
                  )
                }
                onSetKeyGroupPriority={(groupId, priority) =>
                  void channels.setCredentialGroupPriority(
                    selected.id,
                    groupId,
                    priority,
                  )
                }
                onProtocolChange={handleProtocolChange}
                onDownloadProtocol={downloadProtocol}
                onRemoveProtocol={(protocolOption) =>
                  void handleRemoveProtocol(protocolOption)
                }
                onDetect={handleDetect}
                onVerify={handleVerify}
                onToggleNewProtocol={toggleNewProtocol}
                onRestoreBuiltinProtocols={() =>
                  void handleRestoreBuiltinProtocols()
                }
                onDownloadProtocolTemplate={downloadProtocolTemplate}
                onImportProtocolFile={(file) =>
                  void handleImportProtocolFile(file)
                }
                onImportTextChange={setNpImportText}
                onClearImported={() => setNpImported(null)}
                onClearImportError={() => setNpError('')}
                onCheckImportedProtocol={checkImportedProtocol}
                onSaveImportedProtocol={handleSaveImportedProtocol}
              />

              <SettingsModelsView
                busy={busy}
                activeGroup={activeGroup}
                activeModelCache={activeModelCache}
                selectedGroups={selectedGroups}
                panelOpen={panelOpen}
                draftCategory={draftCategory}
                draftKeyword={draftKeyword}
                draftChecked={draftChecked}
                draftList={draftList}
                onRefresh={() => void handleRefresh()}
                onOpenPanel={() => void openPanel()}
                onClosePanel={() => setPanelOpen(false)}
                onDraftCategoryChange={setDraftCategory}
                onDraftKeywordChange={setDraftKeyword}
                onToggleDraft={toggleDraft}
                onModelCategoryChange={(modelId, category) =>
                  void channels.setModelCategory(
                    selected.id,
                    modelId,
                    category,
                    activeGroup?.id,
                  )
                }
                onDropSelectedModel={(modelId) => void dropSelectedModel(modelId)}
                onApplyDraft={() => void applyDraft()}
              />

              <SettingsChannelRouteView
                priority={selected.priority}
                weight={selected.weight}
                allGlobalModels={allGlobalModels}
                customModels={customModels}
                uncommonModelIds={uncommonModelIds}
                activeModels={activeModels}
                activeModelCache={activeModelCache}
                modelAddOpen={modelAddOpen}
                newModelName={newModelName}
                newModelCategory={newModelCategory}
                newModelVendor={newModelVendor}
                showUncommonModels={showUncommonModels}
                mapCategory={mapCategory}
                modelMap={selected.modelMap}
                mapDrafts={mapDrafts}
                mapSaveNotice={mapSaveNotice}
                mapTests={mapTests}
                onPriorityChange={(priority) =>
                  void channels.setRouteTuning(selectedId!, { priority })
                }
                onWeightChange={(weight) =>
                  void channels.setRouteTuning(selectedId!, { weight })
                }
                onModelAddOpenChange={setModelAddOpen}
                onNewModelNameChange={setNewModelName}
                onNewModelCategoryChange={setNewModelCategory}
                onNewModelVendorChange={setNewModelVendor}
                onAddGlobalModel={() => void handleAddGlobalModel()}
                onMapCategoryChange={setMapCategory}
                onShowUncommonModelsChange={setShowUncommonModels}
                onDraftChange={(id, value) =>
                  setMapDrafts((previous) => ({ ...previous, [id]: value }))
                }
                onScheduleModelMapping={scheduleModelMapping}
                onFlushModelMapping={(id, value) =>
                  void flushModelMapping(id, value)
                }
                onTestModelMapping={(id, value) =>
                  void testModelMapping(id, value)
                }
                onModelUncommonChange={(id, uncommon) =>
                  void channels.setModelUncommon(id, uncommon)
                }
                onRemoveGlobalModel={(id) => void handleRemoveGlobalModel(id)}
              />
            </div>
          )}
        </section>
        </div>
      </div>
      )}
      {profileDrawerOpen && selected && profileDrawerBounds
        ? createPortal(
            <SettingsProfileDrawerView
              protocol={selected.protocol}
              icon={profileIconDraft}
              name={profileNameDraft}
              saving={profileSaving}
              bounds={profileDrawerBounds}
              fileInputRef={profileFileRef}
              onBackdropClose={() => setProfileDrawerOpen(false)}
              onClose={() => setProfileDrawerOpen(false)}
              onIconFile={(file) => void handleProfileIconFile(file)}
              onUseBuiltin={() => setProfileIconDraft(null)}
              onResetIcon={() => setProfileIconDraft(selected.icon)}
              onNameChange={setProfileNameDraft}
              onSave={() => void saveProfileDrawer()}
            />,
            document.body,
          )
        : null}
      {channelMenu && menuChannel
        ? createPortal(
            <SettingsChannelContextMenuView
              menuRef={channelMenuRef}
              channelId={menuChannel.id}
              channelName={menuChannel.name}
              builtin={menuBuiltin}
              confirmDelete={menuConfirmDelete}
              busy={busy}
              left={menuLeft}
              top={menuTop}
              width={menuWidth}
              onEdit={editChannel}
              onRequestDelete={() => setMenuConfirmDelete(true)}
              onConfirmDelete={(channelId) => void handleRemove(channelId)}
              onCancelDelete={() => setMenuConfirmDelete(false)}
            />,
            document.body,
          )
        : null}
    </div>
  )
}


