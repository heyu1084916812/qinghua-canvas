import { describe, expect, it } from 'vitest'
import { SettingsPage } from './SettingsPage'

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

describe('SettingsPage 公共导出与页面锚点', () => {
  it('继续导出唯一的 SettingsPage 组件入口', () => {
    expect(SettingsPage).toBeTypeOf('function')
    expect(SettingsPage.name).toBe('SettingsPage')
    expect(SETTINGS_SOURCE).toContain(
      'export function SettingsPage({ embedded = false }: { embedded?: boolean } = {})',
    )
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
