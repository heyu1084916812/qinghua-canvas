import { createElement, createRef, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ProtocolCatalog, ProtocolDefinition } from '../../../domain/project/protocol'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { ChannelStore } from '../../../state/channel/channelStore'
import { SettingsChannelContextMenuView } from './SettingsChannelContextMenuView'
import { SettingsChannelRouteView } from './SettingsChannelRouteView'
import { SettingsChannelSidebarView } from './SettingsChannelSidebarView'
import { SettingsConnectionView } from './SettingsConnectionView'
import { SettingsGlobalRouteView } from './SettingsGlobalRouteView'
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
      onEditProfile: () => {},
      onEnabledChange: () => {},
    })
    expect(headerHtml).toMatch(/^<div /)
    expect(headerHtml).toContain('data-settings-provider-head')
    expect(headerHtml).toContain('data-settings-profile-edit')
    expect(headerHtml).toContain('data-channel-enabled="channel-1"')

    const connectionHtml = render(SettingsConnectionView, {
      channels: {} as ChannelStore,
      selected: {
        id: 'channel-1',
        icon: null,
        tokenTail: null,
        altTokenTail: null,
        hasToken: false,
        hasAltToken: false,
      } as Channel,
      baseUrl: '',
      busy: false,
      activeGroup: null,
      selectedKeyGroups: [],
      credentialSlots: [],
      docUrl: '',
      protocol: 'openai',
      builtinSelected: false,
      visibleProtocolOptions: [],
      pendingProtocols: [],
      referencedProtocolIds: new Set<string>(),
      statusLine: '就绪',
      statusTone: 'info',
      showMockNote: false,
      selectedProtocolNote: '',
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
      onAddKeyGroup: async () => {},
      onRemoveKeyGroup: async () => {},
      onActiveGroupChange: () => {},
      onRenameKeyGroup: () => {},
      onSetKeyGroupPriority: () => {},
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
    expect(connectionHtml).toContain('data-settings-token-row="primary"')
    expect(connectionHtml).toContain('data-settings-status')
  })

  it('协议详情保持导入、待支持和说明的原始顺序', () => {
    const html = render(SettingsProtocolDetailsView, {
      protocol: 'openai',
      pendingProtocols: [
        {
          id: 'pending',
          name: '待支持协议',
          note: '暂不支持',
        } as ProtocolDefinition,
      ],
      showMockNote: true,
      selectedProtocolNote: '需要令牌',
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
    expect(html.indexOf('data-settings-mock-note')).toBeLessThan(
      html.indexOf('data-settings-proto-note'),
    )
  })

  it('模型列表与渠道路由直接返回原 section，并保留关键操作锚点', () => {
    const modelsHtml = render(SettingsModelsView, {
      busy: false,
      activeGroup: null,
      activeModelCache: [],
      selectedGroups: [],
      panelOpen: false,
      draftCategory: 'all',
      draftKeyword: '',
      draftChecked: new Set<string>(),
      draftList: [],
      onRefresh: () => {},
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onDraftCategoryChange: () => {},
      onDraftKeywordChange: () => {},
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
      priority: 0,
      weight: 1,
      allGlobalModels: [],
      customModels: [],
      uncommonModelIds: [],
      activeModels: [],
      activeModelCache: [],
      modelAddOpen: false,
      newModelName: '',
      newModelCategory: 'image',
      newModelVendor: 'openai',
      showUncommonModels: false,
      mapCategory: 'image',
      modelMap: {},
      mapDrafts: {},
      mapSaveNotice: null,
      mapTests: {},
      onPriorityChange: () => {},
      onWeightChange: () => {},
      onModelAddOpenChange: () => {},
      onNewModelNameChange: () => {},
      onNewModelCategoryChange: () => {},
      onNewModelVendorChange: () => {},
      onAddGlobalModel: () => {},
      onMapCategoryChange: () => {},
      onShowUncommonModelsChange: () => {},
      onDraftChange: () => {},
      onScheduleModelMapping: () => {},
      onFlushModelMapping: () => {},
      onTestModelMapping: () => {},
      onModelUncommonChange: () => {},
      onRemoveGlobalModel: () => {},
    })
    expect(routeHtml).toMatch(/^<section /)
    expect(routeHtml).toContain('data-settings-channel-route')
    expect(routeHtml).toContain('data-route-priority')
    expect(routeHtml).toContain('data-route-weight')
    expect(routeHtml).toContain('data-route-map-filter="image"')
    expect(routeHtml).toContain('data-route-map-empty="image"')
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

  it('连接区覆盖 Key 分组、恢复协议、管理提示与错误分支', () => {
    const group = {
      id: 'primary',
      name: '主分组',
      credentialRef: 'credential-primary',
      tokenTail: '1234',
      hasToken: true,
      priority: 10,
      models: [],
      modelCache: [],
      createdAt: 1,
    } satisfies ChannelCredentialGroup
    const html = render(SettingsConnectionView, {
      channels: {} as ChannelStore,
      selected: {
        id: 'channel-1',
        icon: null,
        tokenTail: '1234',
        altTokenTail: null,
        hasToken: true,
        hasAltToken: false,
      } as Channel,
      baseUrl: 'https://relay.example.com/v1',
      busy: true,
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
      credentialSlots: [],
      docUrl: 'https://docs.example.com',
      protocol: 'openai-compatible',
      builtinSelected: false,
      visibleProtocolOptions: [],
      pendingProtocols: [],
      referencedProtocolIds: new Set(['openai-compatible']),
      statusLine: '验证失败',
      statusTone: 'error',
      showMockNote: true,
      selectedProtocolNote: '需要 Key',
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
      onAddKeyGroup: async () => {},
      onRemoveKeyGroup: async () => {},
      onActiveGroupChange: () => {},
      onRenameKeyGroup: () => {},
      onSetKeyGroupPriority: () => {},
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

    expect(html).toContain('data-key-groups')
    expect(html).toContain('data-key-group-tab="primary"')
    expect(html).toContain('data-key-group-tab="backup"')
    expect(html).toContain('data-key-group-editor="primary"')
    expect(html).toContain('data-proto-restore')
    expect(html).toContain('协议管理提示')
    expect(html).toContain('当前协议仍在使用')
    expect(html).toContain('data-status-tone="error"')
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
        createdAt: 1,
      },
      activeModelCache: [imageModel],
      selectedGroups: [
        { category: 'image', label: '生图', models: [{ id: 'image-pro' }] },
      ],
      panelOpen: true,
      draftCategory: 'image',
      draftKeyword: 'image',
      draftChecked: new Set(['image-pro']),
      draftList: [imageModel],
      onRefresh: () => {},
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onDraftCategoryChange: () => {},
      onDraftKeywordChange: () => {},
      onToggleDraft: () => {},
      onModelCategoryChange: () => {},
      onDropSelectedModel: () => {},
      onApplyDraft: () => {},
    })

    expect(html).toContain('data-model-chip')
    expect(html).toContain('data-model-remove="image-pro"')
    expect(html).toContain('data-model-panel')
    expect(html).toContain('data-model-tab="image"')
    expect(html).toContain('data-model-search')
    expect(html).toContain('data-model-option="image-pro"')
    expect(html).toContain('data-model-apply')
  })

  it('渠道路由覆盖添加模型表单、映射行、测试态和删除入口', () => {
    const preset = { id: 'My Image', category: 'image', vendor: 'openai' } as const
    const html = render(SettingsChannelRouteView, {
      priority: 10,
      weight: 2,
      allGlobalModels: [preset],
      customModels: [{ id: 'My Image' }],
      uncommonModelIds: [],
      activeModels: [{ id: 'image-pro', category: 'image', inputTypes: ['text'] }],
      activeModelCache: [{ id: 'image-upstream', category: 'image', inputTypes: ['image'] }],
      modelAddOpen: true,
      newModelName: 'My Image',
      newModelCategory: 'image',
      newModelVendor: 'openai',
      showUncommonModels: true,
      mapCategory: 'image',
      modelMap: { 'My Image': 'image-upstream' },
      mapDrafts: { 'My Image': 'image-upstream' },
      mapSaveNotice: { id: 'My Image', tone: 'error', text: '保存失败' },
      mapTests: { 'My Image': { status: 'checking', message: '' } },
      onPriorityChange: () => {},
      onWeightChange: () => {},
      onModelAddOpenChange: () => {},
      onNewModelNameChange: () => {},
      onNewModelCategoryChange: () => {},
      onNewModelVendorChange: () => {},
      onAddGlobalModel: () => {},
      onMapCategoryChange: () => {},
      onShowUncommonModelsChange: () => {},
      onDraftChange: () => {},
      onScheduleModelMapping: () => {},
      onFlushModelMapping: () => {},
      onTestModelMapping: () => {},
      onModelUncommonChange: () => {},
      onRemoveGlobalModel: () => {},
    })

    expect(html).toContain('data-global-model-form')
    expect(html).toContain('data-global-model-category="image"')
    expect(html).toContain('data-route-map-row="My Image"')
    expect(html).toContain('data-route-map-save-state="error"')
    expect(html).toContain('data-route-map-test-state="checking"')
    expect(html).toContain('data-global-model-remove="My Image"')
    expect(html).toContain('测试中')
    expect(html).toContain('保存失败')
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
