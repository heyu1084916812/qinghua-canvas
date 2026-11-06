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
  'addGlobalModel',
  'removeGlobalModel',
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
    expect(SETTINGS_SOURCE).toContain('const protocolActions = createProtocolActions(protocolPorts)')
    expect(SETTINGS_SOURCE).toContain('item: baseStyles.item')
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
    for (const anchor of anchors) expect(SETTINGS_SOURCE, anchor).toContain(anchor)
    expect(TOKEN_SOURCE).toContain('data-settings-token-row')
  })
})
