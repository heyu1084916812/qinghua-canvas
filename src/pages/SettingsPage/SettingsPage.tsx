import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
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
import * as actionDelegates from './settingsPage/settingsActionDelegates'
import * as channelPresentation from './settingsPage/settingsChannelPresentation'
import * as interactionLifecycle from './settingsPage/settingsInteractionLifecycle'
import * as routingInteractions from './settingsPage/settingsRoutingActions'
import * as statusPresentation from './settingsPage/settingsStatusPresentation'
import { settingsPageStyles as styles } from './settingsPage/settingsPageStyles'
import { SettingsGlobalRouteView } from './settingsPage/SettingsGlobalRouteView'
import { SettingsChannelSidebarView } from './settingsPage/SettingsChannelSidebarView'
import { SettingsChannelConnectionCard } from './settingsPage/SettingsChannelConnectionCard'
import { SettingsChannelGroupWorkspaceCard } from './settingsPage/SettingsChannelGroupWorkspaceCard'
import { SettingsWorkflowManager } from '../../features/settings/SettingsWorkflowManager'
import { SettingsChannelQuickTest } from '../../features/settings/SettingsChannelQuickTest'
import { initialSelectedChannelId, useWorkflowsPageOpener } from './settingsPage/workflowsPageLink'
import { SettingsChannelMappingCard } from './settingsPage/SettingsChannelMappingCard'
import { SettingsChannelOverlays } from './settingsPage/SettingsChannelOverlays'

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
  /** 前端模型目录在映射卡里现算（`useChannelMappingDraft`），页面只用这两个源数据。 */
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

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedChannelId)
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
  /** 「AI 应用和工作流」由连接区的动作按钮控制展开（图一的按钮位） */
  const [draftChecked, setDraftChecked] = useState<ReadonlySet<string>>(new Set())
  const [draftCategory, setDraftCategory] = useState<CategoryFilter>('all')

  /** 正在被拖动的渠道 id（§7.2 拖动排序） */
  const [dragId, setDragId] = useState<string | null>(null)
  const mapSaveTimersRef = useRef(new Map<string, number>())
  const [, setMapDrafts] = useState<Record<string, string>>({})
  const [, setMapTests] = useState<
    Record<string, { status: 'checking' | 'ok' | 'missing' | 'error'; message: string }>
  >({})
  const [mapSaveNotice, setMapSaveNotice] = useState<{
    id: string
    tone: 'ok' | 'error'
    text: string
  } | null>(null)
  /**
   * 协议目录版本号。`protocolCatalog()` 每次返回**新对象**，但 useSyncExternalStore
   * 只在 store 快照变化时重渲染；自建协议增删后靠这个计数把目录重算一遍，
   * 让新协议立刻出现在下拉里（不必刷新页面）。
   */
  const [catalogVersion, setCatalogVersion] = useState(0)
  const catalog = useMemo(() => channels.protocolCatalog(), [channels, catalogVersion])
  const platform = usePlatform()
  const openWorkflowsPage = useWorkflowsPageOpener(embedded)
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
  /**
   * 协议下拉、Key 槽位与协议草稿态（导入面板 / 回执）都随连接卡一起搬进了
   * `SettingsChannelConnectionCard`（2026-11-18「从连接卡开始」）。
   * 旧协议（`openai-images` / `openai-chat`）的过滤规则仍在
   * `settingsChannelPresentation.protocolOptionsFor`：它们只在渠道本身就是它时才出现。
   */

  useEffect(() => {
    void channels.load()
  }, [channels])

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
  const activeModelMap = activeGroup?.modelMap ?? selected?.modelMap ?? {}

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
    setDragId,
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

  const {
    handleCreate, handleEnableChange, handleProfileIconFile, saveProfileDrawer,
    persistForm, handleVerify, handleDetect, handleRefresh,
    openChannelMenu, openChannelMenuFromButton, editChannel, handleRemove,
    handleAddKeyGroup, handleRemoveKeyGroup,
    openPanel,
    toggleDraft, applyDraft, dropSelectedModel, dropOnChannel,
  } = actionDelegates.createSettingsActionDelegates({
    channelActions,
    mappingActions,
    channelState,
  })
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
  return (
    <div className={styles.page} data-settings-page>
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
        {/*
          **选路策略默认收起**（用户 2026-11-15：「后台渠道的位置不要全部塞在一起了」）：
          它是**全局**设置，不是这条渠道的字段，常驻展开会把渠道页顶掉半屏。
          收起来后只留一行摘要，要用时点开 —— 与参考站「渠道页从渠道自己开始」一致。
        */}
        <details className={styles.disclosure} data-settings-routing-disclosure>
          <summary>选路策略 · {ROUTE_PLAN_STRATEGIES.find((item) => item.value === routingPolicy.strategy)?.label ?? routingPolicy.strategy} · 最多 {routingPolicy.maxAttempts} 次 · 路由范围 {selectedRoutingCandidateKeys.size}/{routingCandidates.length}</summary>
        <SettingsGlobalRouteView
          strategy={routingPolicy.strategy}
          strategyOptions={ROUTE_PLAN_STRATEGIES.map((strategy) => ({ value: strategy.value, label: strategy.label, hint: strategy.hint }))}
          maxAttempts={routingPolicy.maxAttempts}
          scopeOpen={routingScopeOpen}
          allowedCandidatesCount={routingPolicy.allowedCandidates.length}
          routingCandidatesCount={routingCandidates.length}
          selectedRoutingCandidateKeys={selectedRoutingCandidateKeys}
          routingChannelGroups={routingChannelGroups}
          expandedRoutingChannels={expandedRoutingChannels}
          onStrategyChange={(value) => void channels.setRoutingPolicy({ strategy: value as RoutePlanStrategy })}
          onMaxAttemptsChange={(value) => void channels.setRoutingPolicy({ maxAttempts: Number(value) })}
          onToggleScope={() => setRoutingScopeOpen((open) => !open)}
          onResetScope={() => void channels.setRoutingPolicy({ allowedCandidates: [] })}
          onToggleRoutingChannel={toggleRoutingChannel}
          onToggleRoutingChannelExpanded={toggleRoutingChannelExpanded}
          onToggleRoutingCandidate={toggleRoutingCandidate}
        />
        </details>

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
              <SettingsChannelConnectionCard
                channel={selected}
                name={name}
                protocol={protocol}
                baseUrl={baseUrl}
                enabled={enabled}
                busy={busy}
                builtinSelected={builtinSelected}
                catalog={catalog}
                hiddenBuiltinProtocolIds={hiddenBuiltinProtocolIds}
                referencedProtocolIds={referencedProtocolIds}
                activeGroup={activeGroup}
                selectedKeyGroups={selectedKeyGroups}
                statusLine={statusLine}
                statusTone={statusTone}
                showMockNote={showMockNote}
                setProtocol={setProtocol}
                setBaseUrl={setBaseUrl}
                setCatalogVersion={setCatalogVersion}
                onPersistForm={persistForm}
                onEnabledChange={(next) => void handleEnableChange(next)}
                onEditProfile={editChannel}
                onPriorityChange={(priority) =>
                  void channels.setRouteTuning(selected.id, { priority })
                }
                onWeightChange={(weight) =>
                  void channels.setRouteTuning(selected.id, { weight })
                }
                onDetect={handleDetect}
                onVerify={handleVerify}
              />

              <SettingsChannelGroupWorkspaceCard
                channel={selected}
                activeGroup={activeGroup}
                selectedKeyGroups={selectedKeyGroups}
                busy={busy}
                activeModelCache={activeModelCache}
                panelOpen={panelOpen}
                draftCategory={draftCategory}
                draftChecked={draftChecked}
                onAddKeyGroup={handleAddKeyGroup}
                onRemoveKeyGroup={(groupId) => handleRemoveKeyGroup({ groupId, skipConfirm: true })}
                onActiveGroupChange={setActiveGroupId}
                onRenameKeyGroup={(groupId, nextName) => void channels.renameCredentialGroup(selected.id, groupId, nextName)}
                onSetKeyGroupPriority={(groupId, priority) => void channels.setCredentialGroupPriority(selected.id, groupId, priority)}
                onRefresh={() => void handleRefresh()}
                onOpenPanel={() => void openPanel()}
                onClosePanel={() => setPanelOpen(false)}
                onDraftCategoryChange={setDraftCategory}
                onToggleDraft={toggleDraft}
                onModelCategoryChange={(modelId, category) => void channels.setModelCategory(selected.id, modelId, category, activeGroup?.id)}
                onDropSelectedModel={(modelId) => void dropSelectedModel(modelId)}
                onApplyDraft={() => void applyDraft()}
              />

              {/* AI 应用 / 工作流在独立页管理（#1131）：渠道页只留连接、Key 和这条入口 */}
              {selected.protocol === 'runninghub-api' ? (
                <SettingsWorkflowManager channel={selected} platform={platform} onOpen={() => openWorkflowsPage(selected.id)} />
              ) : null}

              <SettingsChannelMappingCard
                channel={selected}
                activeGroup={activeGroup}
                activeModels={activeModels}
                customModels={customModels}
                uncommonModelIds={uncommonModelIds}
                modelMap={activeModelMap}
                mapSaveNotice={mapSaveNotice}
                setMapSaveNotice={setMapSaveNotice}
              />

              <SettingsChannelQuickTest
                channel={selected}
                groupId={activeGroup?.id}
                channels={channels}
                platform={platform}
              />
            </div>
          )}
        </section>
        </div>
      </div>
      )}
      <SettingsChannelOverlays
        channel={selected}
        channelsList={channelsList}
        profileDrawerOpen={profileDrawerOpen}
        profileDrawerBounds={profileDrawerBounds}
        profileNameDraft={profileNameDraft}
        profileIconDraft={profileIconDraft}
        profileSaving={profileSaving}
        profileFileRef={profileFileRef}
        channelMenu={channelMenu}
        channelMenuRef={channelMenuRef}
        menuConfirmDelete={menuConfirmDelete}
        busy={busy}
        onProfileClose={() => setProfileDrawerOpen(false)}
        onProfileIconFile={(file) => void handleProfileIconFile(file)}
        onProfileUseBuiltin={() => setProfileIconDraft(null)}
        onProfileResetIcon={() => setProfileIconDraft(selected?.icon ?? null)}
        onProfileNameChange={setProfileNameDraft}
        onProfileSave={() => void saveProfileDrawer()}
        onMenuEdit={editChannel}
        onMenuRequestDelete={() => setMenuConfirmDelete(true)}
        onMenuConfirmDelete={(channelId) => void handleRemove(channelId)}
        onMenuCancelDelete={() => setMenuConfirmDelete(false)}
      />
    </div>
  )
}


