import { describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsPage'
import {
  createChannelActions,
  type ChannelActions,
} from './settingsPage/channelActionCoordinator'
import {
  createModelMappingActions,
  type ModelMappingActions,
} from './settingsPage/modelMappingActionCoordinator'
import {
  createProtocolActions,
  type ProtocolActions,
} from './settingsPage/protocolActionCoordinator'

const SETTINGS_SOURCE = (
  import.meta.glob('./SettingsPage.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./SettingsPage.tsx']

const TOKEN_SOURCE = (
  import.meta.glob('./SettingsChannelTokenField.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./SettingsChannelTokenField.tsx']

const STYLE_FACADE = (
  import.meta.glob('./settingsPage/settingsPageStyles.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./settingsPage/settingsPageStyles.ts']

const VIEW_SOURCES = Object.values(
  import.meta.glob('./settingsPage/Settings*{,View,Card}.tsx', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
).join('\n')

/**
 * 连接卡的协议草稿态（导入 / 导出 / 删除 / 恢复）在 2026-11-18 随卡片一起
 * 从页面搬进了这个 hook —— 端口装配的断言要跟着搬到这边，否则「页面真的接上了
 * 协议动作」这条护栏会退化成永远为真。
 */
const PROTOCOL_DRAFT_SOURCE = (
  import.meta.glob('./settingsPage/useChannelProtocolDraft.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./settingsPage/useChannelProtocolDraft.ts']

/** 模型映射卡的草稿态（前端模型增删 / 映射绑定），2026-11-18 从渠道动作搬进这张卡。 */
const MAPPING_DRAFT_SOURCE = (
  import.meta.glob('./settingsPage/useChannelMappingDraft.ts', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
)['./settingsPage/useChannelMappingDraft.ts']

const CHANNEL_ACTION_KEYS: readonly (keyof ChannelActions)[] = [
  'create',
  'setEnabled',
  'readProfileIconFile',
  'saveProfileDrawer',
  'syncForm',
  'persistForm',
  'verify',
  'detect',
  'refresh',
  'openChannelMenu',
  'openChannelMenuFromButton',
  'editChannel',
  'remove',
  'addKeyGroup',
  'removeKeyGroup',
  'openPanel',
  'toggleDraft',
  'applyDraft',
  'dropSelectedModel',
  'dropOnChannel',
]

const MAPPING_ACTION_KEYS: readonly (keyof ModelMappingActions)[] = [
  'flush',
  'schedule',
  'test',
]

const PROTOCOL_ACTION_KEYS: readonly (keyof ProtocolActions)[] = [
  'createWithUniqueId',
  'bindCreatedProtocol',
  'checkImportedProtocol',
  'handleProtocolChange',
  'importProtocolFile',
  'saveImportedProtocol',
  'saveDownload',
  'downloadProtocolTemplate',
  'downloadProtocol',
  'toggleNewProtocol',
  'removeProtocol',
  'restoreBuiltinProtocols',
]

describe('SettingsPage 公共导出与页面锚点', () => {
  it('继续导出唯一的 SettingsPage 组件入口', () => {
    expect(SettingsPage).toBeTypeOf('function')
    expect(SettingsPage.name).toBe('SettingsPage')
    expect(SETTINGS_SOURCE).toContain(
      'export function SettingsPage({ embedded = false }: { embedded?: boolean } = {})',
    )
  })

  it('三组动作协调器提供稳定的公开函数身份', () => {
    const channelActions = createChannelActions({} as never)
    const mappingActions = createModelMappingActions({} as never)
    const protocolActions = createProtocolActions({} as never)
    for (const key of CHANNEL_ACTION_KEYS) expect(channelActions[key]).toBeTypeOf('function')
    for (const key of MAPPING_ACTION_KEYS) expect(mappingActions[key]).toBeTypeOf('function')
    for (const key of PROTOCOL_ACTION_KEYS) expect(protocolActions[key]).toBeTypeOf('function')
  })

  it('页面真实装配三组动作端口，并保留 CSS Module 回归修复', () => {
    expect(SETTINGS_SOURCE).toContain('const channelActions = createChannelActions(channelPorts)')
    expect(SETTINGS_SOURCE).toContain('const mappingActions = createModelMappingActions(mappingPorts)')
    expect(PROTOCOL_DRAFT_SOURCE).toContain('createProtocolActions({')
    expect(STYLE_FACADE).toContain('item: baseStyles.item')
  })

  it('前端模型的增删随映射卡搬进 useChannelMappingDraft，渠道动作不再持有它们', () => {
    expect(MAPPING_DRAFT_SOURCE).toContain('addGlobalModel')
    expect(MAPPING_DRAFT_SOURCE).toContain('removeGlobalModel')
    expect(MAPPING_DRAFT_SOURCE).toContain('renameGlobalModel')
    expect(MAPPING_DRAFT_SOURCE).toContain('setModelBinding')
    expect(SETTINGS_SOURCE).not.toContain('handleRemoveGlobalModel')
    expect(SETTINGS_SOURCE).not.toContain('handleAddGlobalModel')
  })

  it('保留渠道表单、Token、模型映射、路由策略与资料抽屉锚点', () => {
    const anchors = [
      'data-settings-card',
      'data-settings-global-route',
      'data-routing-scope',
      'data-settings-workarea',
      'data-settings-sidebar',
      'data-channel-list',
      'data-settings-editor',
      'data-settings-form',
      'data-key-groups',
      'data-settings-models',
      'data-settings-channel-route',
      'data-settings-profile-drawer',
    ]
    const settingsSurfaceSource = `${SETTINGS_SOURCE}\n${VIEW_SOURCES}`
    for (const anchor of anchors) expect(settingsSurfaceSource, anchor).toContain(anchor)
    expect(TOKEN_SOURCE).toContain('data-settings-token-row')
  })

  it('★ data-settings-card 只挂一处：冒烟与几何门禁按它取唯一的渠道卡片（根改用 data-settings-page，浮层 980 豁免见 GlobalSettingsOverlay.module.css）', () => {
    expect(SETTINGS_SOURCE.match(/data-settings-card(?![-\w])/g) ?? []).toHaveLength(1)
    expect(SETTINGS_SOURCE).toContain('data-settings-page')
  })
})
