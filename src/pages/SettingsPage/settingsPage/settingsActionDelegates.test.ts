import { describe, expect, it, vi } from 'vitest'
import { createSettingsActionDelegates } from './settingsActionDelegates'

describe('设置页动作委托', () => {
  it('频道动作每次调用取当前快照，同步动作保持同步', () => {
    const channelState = vi.fn(() => ({ selectedId: 'a' }))
    const channelActions = {
      create: vi.fn(() => 'created'),
      setEnabled: vi.fn(() => 'enabled'),
      readProfileIconFile: vi.fn(async () => undefined),
      saveProfileDrawer: vi.fn(async () => undefined),
      persistForm: vi.fn(async () => 'saved'),
      verify: vi.fn(async () => undefined),
      detect: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      openChannelMenu: vi.fn(),
      openChannelMenuFromButton: vi.fn(),
      editChannel: vi.fn(() => 'edited'),
      remove: vi.fn(async () => undefined),
      addKeyGroup: vi.fn(async () => undefined),
      removeKeyGroup: vi.fn(async () => undefined),
      addGlobalModel: vi.fn(async () => undefined),
      removeGlobalModel: vi.fn(async () => undefined),
      openPanel: vi.fn(() => 'opened'),
      toggleDraft: vi.fn(() => 'toggled'),
      applyDraft: vi.fn(async () => undefined),
      dropSelectedModel: vi.fn(async () => undefined),
      dropOnChannel: vi.fn(async () => undefined),
    }
    const mappingActions = {
      flush: vi.fn(async () => undefined),
      schedule: vi.fn(),
      test: vi.fn(async () => undefined),
    }
    const actions = createSettingsActionDelegates({
      channelActions: channelActions as never,
      mappingActions,
      channelState: channelState as never,
    })

    expect(actions.editChannel('b')).toBe('edited')
    expect(actions.openPanel()).toBe('opened')
    expect(actions.toggleDraft('m', true)).toBe('toggled')
    expect(channelState).toHaveBeenCalledTimes(3)
    expect(channelActions.editChannel).toHaveBeenCalledWith({ selectedId: 'a' }, 'b')
    expect(actions.flushModelMapping).toBe(mappingActions.flush)
  })

  it('协议动作不再由页面委托：它们随连接卡走 useChannelProtocolDraft', async () => {
    const actions = createSettingsActionDelegates({
      channelActions: {} as never,
      mappingActions: {} as never,
      channelState: (() => ({ selectedId: 'a' })) as never,
    })
    expect(Object.keys(actions)).not.toContain('handleProtocolChange')
    expect(Object.keys(actions)).not.toContain('downloadProtocol')
    const { useChannelProtocolDraft } = await import('./useChannelProtocolDraft')
    expect(useChannelProtocolDraft).toBeTypeOf('function')
  })
})
