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
    const protocolState = vi.fn(() => ({ selectedId: 'a' }))
    const protocolActions = {
      handleProtocolChange: vi.fn(() => 'changed'),
      checkImportedProtocol: vi.fn(() => 'checked'),
      importProtocolFile: vi.fn(async () => undefined),
      saveImportedProtocol: vi.fn(async () => undefined),
      downloadProtocolTemplate: vi.fn(async () => undefined),
      downloadProtocol: vi.fn(async () => undefined),
      toggleNewProtocol: vi.fn(() => 'toggled'),
      removeProtocol: vi.fn(async () => undefined),
      restoreBuiltinProtocols: vi.fn(async () => undefined),
    }
    const mappingActions = {
      flush: vi.fn(async () => undefined),
      schedule: vi.fn(),
      test: vi.fn(async () => undefined),
    }
    const actions = createSettingsActionDelegates({
      channelActions: channelActions as never,
      mappingActions,
      protocolActions: protocolActions as never,
      channelState: channelState as never,
      protocolState: protocolState as never,
    })

    expect(actions.editChannel('b')).toBe('edited')
    expect(actions.openPanel()).toBe('opened')
    expect(actions.toggleDraft('m', true)).toBe('toggled')
    expect(actions.handleProtocolChange('openai-compatible')).toBe('changed')
    expect(channelState).toHaveBeenCalledTimes(3)
    expect(protocolState).toHaveBeenCalledOnce()
    expect(channelActions.editChannel).toHaveBeenCalledWith({ selectedId: 'a' }, 'b')
    expect(actions.flushModelMapping).toBe(mappingActions.flush)
  })
})
