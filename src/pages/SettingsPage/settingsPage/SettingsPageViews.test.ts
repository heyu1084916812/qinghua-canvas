import { createElement, createRef, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ProtocolCatalog, ProtocolDefinition } from '../../../domain/project/protocol'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { ChannelStore } from '../../../state/channel/channelStore'
import { ChannelTokenField } from '../SettingsChannelTokenField'
import { SettingsChannelGroupWorkspaceCard } from './SettingsChannelGroupWorkspaceCard'
import { SettingsChannelContextMenuView } from './SettingsChannelContextMenuView'
import { SettingsChannelRouteView } from './SettingsChannelRouteView'
import { SettingsChannelSidebarView } from './SettingsChannelSidebarView'
import { SettingsConnectionView } from './SettingsConnectionView'
import { SettingsGlobalRouteView } from './SettingsGlobalRouteView'
import { SettingsKeyGroupView } from './SettingsKeyGroupView'
import { SettingsModelsView } from './SettingsModelsView'
import { SettingsProfileDrawerView } from './SettingsProfileDrawerView'
import { SettingsProtocolDetailsView } from './SettingsProtocolDetailsView'
import { SettingsProviderHeaderView } from './SettingsProviderHeaderView'

const render = <Props extends object>(
  component: (props: Props) => ReactNode,
  props: Props,
) => renderToStaticMarkup(createElement(component, props))

describe('SettingsPage 视图拆分', () => {
  it('全局路由直接保留两个原始 section，不增加布局包裹层', () => {
    const html = render(SettingsGlobalRouteView, {
      strategy: 'priority',
      strategyOptions: [],
      maxAttempts: 3,
      scopeOpen: true,
      allowedCandidatesCount: 0,
      routingCandidatesCount: 0,
      selectedRoutingCandidateKeys: new Set<string>(),
      routingChannelGroups: [],
      expandedRoutingChannels: new Set<string>(),
      onStrategyChange: () => {},
      onMaxAttemptsChange: () => {},
      onToggleScope: () => {},
      onResetScope: () => {},
      onToggleRoutingChannel: () => {},
      onToggleRoutingChannelExpanded: () => {},
      onToggleRoutingCandidate: () => {},
    })

    expect(html).toMatch(/^<section /)
    expect(html).toContain('data-settings-global-route')
    expect(html).toContain('data-routing-scope')
    expect(html).toContain('data-routing-scope-toggle')
    expect(html).not.toMatch(/^<div[^>]*><section /)
  })

  it('渠道侧栏直接返回原 aside，并保留搜索、筛选、列表与新增入口', () => {
    const html = render(SettingsChannelSidebarView, {
      catalog: {} as ProtocolCatalog,
      channels: [],
      visibleChannels: [],
      selectedId: null,
      channelSearch: '',
      channelFilter: 'all',
      dragId: null,
      openChannelId: null,
      onSearchChange: () => {},
      onFilterChange: () => {},
      onSelectChannel: () => {},
      onOpenChannelMenu: () => {},
      onOpenChannelMenuFromButton: () => {},
      onDragStart: () => {},
      onDragEnd: () => {},
      onDropOnChannel: () => {},
      onCreate: () => {},
    })

    expect(html).toMatch(/^<aside /)
    expect(html).toContain('data-settings-sidebar')
    expect(html).toContain('data-channel-tools')
    expect(html).toContain('data-channel-search')
    expect(html).toContain('data-channel-list')
    expect(html).toContain('data-channel-add')
  })

  it('服务商头部与连接区保留原锚点，不新增 section 包裹', () => {
    const headerHtml = render(SettingsProviderHeaderView, {
      channelId: 'channel-1',
      protocol: 'openai',
      icon: null,
      name: '服务商',
      ariaName: '服务商',
      enabled: true,
      priority: 0,
      weight: 0,
      onEditProfile: () => {},
      onEnabledChange: () => {},
      onPriorityChange: () => {},
      onWeightChange: () => {},
    })
    expect(headerHtml).toMatch(/^<div /)
    expect(headerHtml).toContain('data-settings-provider-head')
    expect(headerHtml).toContain('data-settings-profile-edit')
    expect(headerHtml).toContain('data-channel-enabled="channel-1"')
    expect(headerHtml).toContain('data-settings-channel-routing-panel')
    expect(headerHtml).toContain('data-settings-provider-route-inline')
    expect(headerHtml).not.toContain('仅影响不同渠道之间的竞争')
    expect(headerHtml).not.toContain('data-settings-channel-routing=')

    const connectionHtml = render(SettingsConnectionView, {
      baseUrl: '',
      busy: false,
      protocol: 'openai',
      builtinSelected: false,
      visibleProtocolOptions: [],
      pendingProtocols: [],
      referencedProtocolIds: new Set<string>(),
      statusLine: '就绪',
      statusTone: 'info',
      showMockNote: false,
      newProtoOpen: false,
      hiddenBuiltinProtocolCount: 0,
      npNotice: '',
      protoManageNotice: '',
      protoRemoveError: '',
      npImportText: '',
      npImported: null,
      npError: '',
      onBaseUrlChange: () => {},
      onPersistForm: () => {},
      onProtocolChange: () => {},
      onDownloadProtocol: () => {},
      onRemoveProtocol: () => {},
      onDetect: () => {},
      onVerify: () => {},
      onToggleNewProtocol: () => {},
      onRestoreBuiltinProtocols: () => {},
      onDownloadProtocolTemplate: () => {},
      onImportProtocolFile: () => {},
      onImportTextChange: () => {},
      onClearImported: () => {},
      onClearImportError: () => {},
      onCheckImportedProtocol: () => {},
      onSaveImportedProtocol: () => {},
    })
    expect(connectionHtml).toMatch(/^<section /)
    expect(connectionHtml).toContain('data-settings-connection')
    expect(connectionHtml).toContain('data-settings-baseurl')
    expect(connectionHtml).toContain('data-settings-status')
    expect(connectionHtml).not.toContain('AI 应用和工作流')
  })

  it('协议详情保持导入、待支持和说明的原始顺序', () => {
    const html = render(SettingsProtocolDetailsView, {
      protocol: 'runninghub-api',
      pendingProtocols: [
        {
          id: 'pending',
          name: '待支持协议',
          note: '暂不支持',
        } as ProtocolDefinition,
      ],
      showMockNote: true,
      newProtoOpen: true,
      npImportText: '',
      npImported: null,
      npError: '',
      onDownloadProtocolTemplate: () => {},
      onImportProtocolFile: () => {},
      onImportTextChange: () => {},
      onClearImported: () => {},
      onClearImportError: () => {},
      onCheckImportedProtocol: () => {},
      onSaveImportedProtocol: () => {},
    })

    expect(html).toMatch(/^<div /)
    expect(html.indexOf('data-proto-form')).toBeLessThan(html.indexOf('data-proto-pending'))
    expect(html.indexOf('data-proto-pending')).toBeLessThan(
      html.indexOf('data-settings-mock-note'),
    )
    /* 站点说明文案已按用户要求整体撤掉，不再渲染 data-settings-proto-note */
    expect(html).not.toContain('data-settings-proto-note')
  })

  it('模型列表与渠道路由直接返回原 section，并保留关键操作锚点', () => {
    const modelsHtml = render(SettingsModelsView, {
      busy: false,
      activeGroup: null,
      activeModelCache: [],
      selectedGroups: [],
      panelOpen: false,
      draftCategory: 'all',
      draftChecked: new Set<string>(),
      draftList: [],
      onRefresh: () => {},
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onDraftCategoryChange: () => {},
      onToggleDraft: () => {},
      onModelCategoryChange: () => {},
      onDropSelectedModel: () => {},
      onApplyDraft: () => {},
    })
    expect(modelsHtml).toMatch(/^<section /)
    expect(modelsHtml).toContain('data-settings-models')
    expect(modelsHtml).toContain('data-models-empty')
    expect(modelsHtml).toContain('拉取模型')
    expect(modelsHtml).toContain('选择模型')

    const routeHtml = render(SettingsChannelRouteView, {
      allGlobalModels: [],
      customModels: [],
      uncommonModelIds: [],
      activeModels: [],
      modelAddOpen: false,
      newModelName: '',
      newModelCategory: 'image',
      newModelVendor: 'openai',
      showUncommonModels: false,
      modelMap: {},
      mapSaveNotice: null,
      onModelAddOpenChange: () => {},
      onNewModelNameChange: () => {},
      onNewModelCategoryChange: () => {},
      onNewModelVendorChange: () => {},
      onAddGlobalModel: () => {},
      onShowUncommonModelsChange: () => {},
      onBindModel: () => {},
      onModelUncommonChange: () => {},
      onRemoveGlobalModel: () => {},
    })
    expect(routeHtml).toMatch(/^<section /)
    expect(routeHtml).toContain('data-settings-channel-route')
    /* #1144 起空分类不再出提示条：没有前端模型时整张映射表不渲染。 */
    expect(routeHtml).not.toContain('data-route-map-table')
    expect(routeHtml).not.toContain('data-route-map-row=')
  })

  it('资料抽屉与渠道菜单保留原 portal 根节点和交互锚点', () => {
    const fileInputRef = createRef<HTMLInputElement>()
    const drawerHtml = render(SettingsProfileDrawerView, {
      protocol: 'openai',
      icon: null,
      name: '服务商',
      saving: false,
      bounds: { left: 10, top: 20, width: 300, height: 400 },
      fileInputRef,
      onBackdropClose: () => {},
      onClose: () => {},
      onIconFile: () => {},
      onUseBuiltin: () => {},
      onResetIcon: () => {},
      onNameChange: () => {},
      onSave: () => {},
    })
    expect(drawerHtml).toMatch(/^<div /)
    expect(drawerHtml).toContain('data-settings-profile-drawer')
    expect(drawerHtml).toContain('data-settings-profile-upload')
    expect(drawerHtml).toContain('data-settings-profile-save')

    const menuHtml = render(SettingsChannelContextMenuView, {
      menuRef: createRef<HTMLDivElement>(),
      channelId: 'channel-1',
      channelName: '服务商',
      builtin: false,
      confirmDelete: false,
      busy: false,
      left: 10,
      top: 20,
      width: 180,
      onEdit: () => {},
      onRequestDelete: () => {},
      onConfirmDelete: () => {},
      onCancelDelete: () => {},
    })
    expect(menuHtml).toMatch(/^<div /)
    expect(menuHtml).toContain('data-channel-context-menu="channel-1"')
    expect(menuHtml).toContain('data-channel-menu-edit="channel-1"')
    expect(menuHtml).toContain('data-channel-menu-delete="channel-1"')
  })

  it('渠道侧栏覆盖内置与自定义渠道、选中态和菜单入口', () => {
    const channel = (id: string, name: string): Channel =>
      ({
        id,
        name,
        icon: null,
        protocol: 'openai-compatible',
        enabled: true,
        models: [],
        modelCache: [],
      }) as unknown as Channel
    const html = render(SettingsChannelSidebarView, {
      catalog: { all: [] } as unknown as ProtocolCatalog,
      channels: [
        channel('ch_builtin_modelscope', '内置服务'),
        channel('ch_custom', '自定义服务'),
      ],
      visibleChannels: [
        channel('ch_builtin_modelscope', '内置服务'),
        channel('ch_custom', '自定义服务'),
      ],
      selectedId: 'ch_custom',
      channelSearch: '',
      channelFilter: 'all',
      dragId: null,
      openChannelId: 'ch_custom',
      onSearchChange: () => {},
      onFilterChange: () => {},
      onSelectChannel: () => {},
      onOpenChannelMenu: () => {},
      onOpenChannelMenuFromButton: () => {},
      onDragStart: () => {},
      onDragEnd: () => {},
      onDropOnChannel: () => {},
      onCreate: () => {},
    })

    expect(html).toContain('data-channel-selected="true"')
    expect(html).toContain('data-channel-drag-handle="ch_custom"')
    expect(html).not.toContain('data-channel-drag-handle="ch_builtin_modelscope"')
    expect(html).toContain('data-channel-menu-trigger="ch_custom"')
    expect(html).toContain('data-channel-state-dot="ch_custom"')
  })

  it('连接区覆盖恢复协议、管理提示与错误分支', () => {
    const html = render(SettingsConnectionView, {
      baseUrl: 'https://relay.example.com/v1',
      busy: true,
      protocol: 'openai-compatible',
      builtinSelected: false,
      visibleProtocolOptions: [],
      pendingProtocols: [],
      referencedProtocolIds: new Set(['openai-compatible']),
      statusLine: '验证失败',
      statusTone: 'error',
      showMockNote: true,
      newProtoOpen: false,
      hiddenBuiltinProtocolCount: 2,
      npNotice: '导入成功',
      protoManageNotice: '协议管理提示',
      protoRemoveError: '当前协议仍在使用',
      npImportText: '',
      npImported: null,
      npError: '',
      onBaseUrlChange: () => {},
      onPersistForm: () => {},
      onProtocolChange: () => {},
      onDownloadProtocol: () => {},
      onRemoveProtocol: () => {},
      onDetect: () => {},
      onVerify: () => {},
      onToggleNewProtocol: () => {},
      onRestoreBuiltinProtocols: () => {},
      onDownloadProtocolTemplate: () => {},
      onImportProtocolFile: () => {},
      onImportTextChange: () => {},
      onClearImported: () => {},
      onClearImportError: () => {},
      onCheckImportedProtocol: () => {},
      onSaveImportedProtocol: () => {},
    })

    expect(html).toContain('data-proto-restore')
    expect(html).toContain('协议管理提示')
    expect(html).toContain('当前协议仍在使用')
    expect(html).not.toContain('data-settings-proto-note')
    expect(html).toContain('data-status-tone="error"')
  })

  it('Key 分组是文件夹标签：选中态只有名称与优先级，没有圆点与编辑/删除按钮', () => {
    const group = {
      id: 'primary',
      name: '主分组',
      credentialRef: 'credential-primary',
      tokenTail: '1234',
      hasToken: true,
      priority: 10,
      models: [],
      modelCache: [],
      modelMap: {},
      createdAt: 1,
    } satisfies ChannelCredentialGroup
    const html = render(SettingsKeyGroupView, {
      activeGroup: group,
      selectedKeyGroups: [
        group,
        {
          ...group,
          id: 'backup',
          name: '备用分组',
          hasToken: false,
          tokenTail: null,
          priority: 0,
        },
      ],
      busy: false,
      onAddKeyGroup: async () => {},
      onRemoveKeyGroup: async () => {},
      onActiveGroupChange: () => {},
      onRenameKeyGroup: () => {},
      onSetKeyGroupPriority: () => {},
    })

    expect(html).toContain('data-key-group-switcher')
    expect(html).toContain('data-key-group-tab="primary"')
    expect(html).toContain('data-key-group-tab="backup"')
    expect(html).toContain('data-key-group-editor="primary"')
    /* 选中态：名称 + 优先级；未选中：只有名称 */
    expect(html).toContain('主分组')
    expect(html).toContain('P10')
    expect(html).toContain('备用分组')
    expect(html).not.toContain('P0<')
    /* 标题里不再挂状态点、编辑、删除按钮 */
    expect(html).not.toContain('重命名分组')
    expect(html).not.toContain('删除分组')
    expect(html).not.toContain('data-key-group-name="')
  })

  it('分组卡只加一层 groupWorkspace 壳：Key 分组与模型列表仍是它下面的一对兄弟', () => {
    const group = {
      id: 'primary',
      name: '主分组',
      credentialRef: 'credential-primary',
      tokenTail: '1234',
      hasToken: true,
      priority: 10,
      models: [],
      modelCache: [],
      modelMap: {},
      createdAt: 1,
    } satisfies ChannelCredentialGroup
    const html = render(SettingsChannelGroupWorkspaceCard, {
      channel: {
        id: 'channel-1',
        name: '渠道一',
        protocol: 'mock',
        baseUrl: '',
        enabled: true,
        priority: 0,
        weight: 1,
        models: [],
        modelCache: [],
        modelMap: {},
        credentialGroups: [group],
      } as unknown as Channel,
      activeGroup: group,
      selectedKeyGroups: [group],
      busy: false,
      activeModelCache: [],
      panelOpen: false,
      draftCategory: 'all',
      draftChecked: new Set<string>(),
      onAddKeyGroup: async () => {},
      onRemoveKeyGroup: async () => {},
      onActiveGroupChange: () => {},
      onRenameKeyGroup: () => {},
      onSetKeyGroupPriority: () => {},
      onRefresh: () => {},
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onDraftCategoryChange: () => {},
      onToggleDraft: () => {},
      onModelCategoryChange: () => {},
      onDropSelectedModel: () => {},
      onApplyDraft: () => {},
    })

    /* 唯一的壳：data-settings-group-workspace 只出现一次，且直接包住两块内容 */
    expect(html.match(/data-settings-group-workspace/g) ?? []).toHaveLength(1)
    expect(html).toContain('data-key-groups')
    expect(html).toContain('data-settings-models')
    expect(html).toContain('data-key-group-tab="primary"')
    /* 推导值在卡内算：没有任何模型时不渲染空分组标题 */
    expect(html).not.toContain('data-settings-model-group=')
  })

  it('Key 分组官网入口使用短文案', () => {
    const channels = {} as ChannelStore
    const html = render(ChannelTokenField, {
      channels,
      channelId: 'channel-1',
      slot: 'primary',
      label: 'API Key',
      docUrl: 'https://docs.example.com',
      savedTail: '1234',
      saved: true,
    })

    expect(html).toContain('获取令牌')
    expect(html).not.toContain('去官网获取令牌')
  })

  it('模型面板覆盖已选模型、缓存模型和草稿切换结构', () => {
    const imageModel: ModelCapability = {
      id: 'image-pro',
      category: 'image',
      inputTypes: ['text', 'image'],
    }
    const html = render(SettingsModelsView, {
      busy: false,
      activeGroup: {
        id: 'primary',
        name: '主分组',
        credentialRef: 'credential-primary',
        tokenTail: null,
        hasToken: true,
        priority: 0,
        models: [imageModel],
        modelCache: [imageModel],
        modelMap: {},
        createdAt: 1,
      },
      activeModelCache: [imageModel],
      selectedGroups: [
        { category: 'image', label: '生图', models: [{ id: 'image-pro' }] },
      ],
      panelOpen: true,
      draftCategory: 'image',
      draftChecked: new Set(['image-pro']),
      draftList: [imageModel],
      onRefresh: () => {},
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onDraftCategoryChange: () => {},
      onToggleDraft: () => {},
      onModelCategoryChange: () => {},
      onDropSelectedModel: () => {},
      onApplyDraft: () => {},
    })

    expect(html).toContain('data-model-chip')
    expect(html).toContain('data-model-remove="image-pro"')
    expect(html).toContain('data-model-panel')
    expect(html).toContain('data-model-tab="image"')
    expect(html).not.toContain('data-model-search')
    expect(html).toContain('data-model-option="image-pro"')
    expect(html).toContain('data-model-apply')
  })

  it('渠道路由覆盖添加模型表单、映射行、测试态和删除入口', () => {
    const preset = { id: 'My Image', category: 'image', vendor: 'openai' } as const
    const html = render(SettingsChannelRouteView, {
      allGlobalModels: [preset],
      customModels: [{ id: 'My Image' }],
      uncommonModelIds: [],
      activeModels: [
        { id: 'image-upstream', category: 'image', inputTypes: ['text'] },
      ],
      modelAddOpen: true,
      newModelName: 'My Image',
      newModelCategory: 'image',
      newModelVendor: 'openai',
      showUncommonModels: true,
      modelMap: { 'My Image': 'image-upstream' },
      mapSaveNotice: { id: 'My Image', tone: 'error', text: '保存失败' },
      onModelAddOpenChange: () => {},
      onNewModelNameChange: () => {},
      onNewModelCategoryChange: () => {},
      onNewModelVendorChange: () => {},
      onAddGlobalModel: () => {},
      onShowUncommonModelsChange: () => {},
      onBindModel: () => {},
      onModelUncommonChange: () => {},
      onRemoveGlobalModel: () => {},
    })

    expect(html).toContain('data-global-model-form')
    expect(html).toContain('data-global-model-close')
    expect(html).toContain('data-route-map-row="My Image"')
    expect(html).toContain('data-route-map-frontend="My Image"')
    expect(html).toContain('data-route-map-real="My Image"')
    expect(html).toContain('data-route-map-filter="image"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html.indexOf('data-route-map-frontend="My Image"')).toBeLessThan(
      html.indexOf('data-route-map-real="My Image"'),
    )
    expect(html).toContain('data-route-map-uncommon="My Image"')
    expect(html).toContain('data-global-model-remove="My Image"')
    expect(html).toContain('保存失败')

    const hidden = render(SettingsChannelRouteView, {
      allGlobalModels: [preset],
      customModels: [{ id: 'My Image' }],
      uncommonModelIds: ['My Image'],
      activeModels: [
        { id: 'image-upstream', category: 'image', inputTypes: ['text'] },
      ],
      modelAddOpen: false,
      newModelName: '',
      newModelCategory: 'image',
      newModelVendor: 'openai',
      showUncommonModels: false,
      modelMap: { 'My Image': 'image-upstream' },
      mapSaveNotice: null,
      onModelAddOpenChange: () => {},
      onNewModelNameChange: () => {},
      onNewModelCategoryChange: () => {},
      onNewModelVendorChange: () => {},
      onAddGlobalModel: () => {},
      onShowUncommonModelsChange: () => {},
      onBindModel: () => {},
      onModelUncommonChange: () => {},
      onRemoveGlobalModel: () => {},
    })
    expect(hidden).not.toContain('data-route-map-row="My Image"')

    const chatPreset = {
      id: 'My Chat',
      category: 'chat',
      vendor: 'openai',
    } as const
    const grouped = render(SettingsChannelRouteView, {
      allGlobalModels: [preset, chatPreset],
      customModels: [{ id: 'My Image' }, { id: 'My Chat' }],
      uncommonModelIds: [],
      activeModels: [
        { id: 'image-upstream', category: 'image', inputTypes: ['text'] },
        { id: 'chat-upstream', category: 'chat', inputTypes: ['text'] },
      ],
      modelAddOpen: false,
      newModelName: '',
      newModelCategory: 'image',
      newModelVendor: 'openai',
      showUncommonModels: false,
      modelMap: {},
      mapSaveNotice: null,
      onModelAddOpenChange: () => {},
      onNewModelNameChange: () => {},
      onNewModelCategoryChange: () => {},
      onNewModelVendorChange: () => {},
      onAddGlobalModel: () => {},
      onShowUncommonModelsChange: () => {},
      onBindModel: () => {},
      onModelUncommonChange: () => {},
      onRemoveGlobalModel: () => {},
    })
    expect(grouped).toContain('role="tablist"')
    expect(grouped).toContain('data-route-map-filter="image"')
    expect(grouped).toContain('data-route-map-filter="chat"')
    expect(grouped).toContain('aria-selected="true"')
    expect(grouped).toContain('aria-controls="settings-model-category-panel"')
    expect(grouped).toContain('role="tabpanel"')
    expect(grouped).toContain('id="settings-model-category-panel"')
    /* 三分类固定顺序（对话 → 图片 → 视频），默认落在「对话」。 */
    expect(grouped).toContain('data-route-map-row="My Chat"')
    expect(grouped).not.toContain('data-route-map-row="My Image"')

    const irrelevantCategory = render(SettingsChannelRouteView, {
      allGlobalModels: [preset],
      customModels: [{ id: 'My Image' }],
      uncommonModelIds: [],
      activeModels: [
        { id: 'video-upstream', category: 'video', inputTypes: ['text'] },
      ],
      modelAddOpen: false,
      newModelName: '',
      newModelCategory: 'image',
      newModelVendor: 'openai',
      showUncommonModels: true,
      modelMap: {},
      mapSaveNotice: null,
      onModelAddOpenChange: () => {},
      onNewModelNameChange: () => {},
      onNewModelCategoryChange: () => {},
      onNewModelVendorChange: () => {},
      onAddGlobalModel: () => {},
      onShowUncommonModelsChange: () => {},
      onBindModel: () => {},
      onModelUncommonChange: () => {},
      onRemoveGlobalModel: () => {},
    })
    /* #1144 起映射固定展示「实际配置的全部前端模型」：上游只有视频模型也照样列出这条图片映射。 */
    expect(irrelevantCategory).toContain('data-route-map-row="My Image"')
    expect(irrelevantCategory).toContain('data-route-map-filter="image"')
  })

  it('渠道菜单覆盖内置渠道无删除与删除二次确认', () => {
    const builtinHtml = render(SettingsChannelContextMenuView, {
      menuRef: createRef<HTMLDivElement>(),
      channelId: 'ch_builtin',
      channelName: '内置服务',
      builtin: true,
      confirmDelete: false,
      busy: false,
      left: 10,
      top: 20,
      width: 180,
      onEdit: () => {},
      onRequestDelete: () => {},
      onConfirmDelete: () => {},
      onCancelDelete: () => {},
    })
    expect(builtinHtml).toContain('data-channel-menu-edit="ch_builtin"')
    expect(builtinHtml).not.toContain('data-channel-menu-delete=')

    const confirmHtml = render(SettingsChannelContextMenuView, {
      menuRef: createRef<HTMLDivElement>(),
      channelId: 'ch_custom',
      channelName: '自定义服务',
      builtin: false,
      confirmDelete: true,
      busy: true,
      left: 10,
      top: 20,
      width: 180,
      onEdit: () => {},
      onRequestDelete: () => {},
      onConfirmDelete: () => {},
      onCancelDelete: () => {},
    })
    expect(confirmHtml).toContain('data-channel-menu-delete-confirm="ch_custom"')
    expect(confirmHtml).toContain('data-channel-menu-delete-cancel')
    expect(confirmHtml).toContain('不可撤销')
    expect(confirmHtml).toContain('disabled=""')
  })
})
