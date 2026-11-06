import { describe, expect, it, vi } from 'vitest'
import type { Channel, ChannelCredentialGroup } from '../../../domain/project/channel'
import type { ProtocolCatalog } from '../../../domain/project/protocol'
import type { ModelCapability } from '../../../domain/shared/capability'
import { createChannelActions, type ChannelActionPorts, type ChannelActionState } from './channelActionCoordinator'

function harness(overrides: Partial<ChannelActionState> = {}) {
  const calls: string[] = []
  const channelList = [
    { id: 'c1', name: '服务', icon: null },
    { id: 'c2', name: '第二服务', icon: null },
  ] as unknown as readonly Channel[]
  const channels = {
    create: vi.fn(async () => ({ id: 'new' })),
    update: vi.fn(async (_id: string, patch: Record<string, unknown>) => ({
      id: _id,
      name: '新名称',
      protocol: typeof patch.protocol === 'string' ? patch.protocol : 'mock',
      baseUrl: typeof patch.baseUrl === 'string' ? patch.baseUrl : '',
      enabled: typeof patch.enabled === 'boolean' ? patch.enabled : false,
      icon: typeof patch.icon === 'string' || patch.icon === null ? patch.icon : null,
      credentialGroups: [],
      models: [],
      modelCache: [],
    })),
    setEnabled: vi.fn(async () => {}),
    verify: vi.fn(async () => {}),
    detectProtocol: vi.fn(async () => 'openai-compatible'),
    refreshModels: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    addCredentialGroup: vi.fn(async () => ({ id: 'g2' })),
    removeCredentialGroup: vi.fn(async () => {}),
    addGlobalModel: vi.fn(async () => ({ category: 'chat' })),
    removeGlobalModel: vi.fn(async () => {}),
    setModels: vi.fn(async () => {}),
    reorder: vi.fn(async () => {}),
  }
  const ports = {
    channels,
    getChannels: vi.fn(() => channelList),
    setSelectedId: vi.fn(),
    setActiveGroupId: vi.fn(),
    setChannelFilter: vi.fn(),
    setChannelSearch: vi.fn(),
    setForm: vi.fn(),
    setBusy: vi.fn(),
    setVerifiedFor: vi.fn(),
    setChannelMenu: vi.fn(),
    setMenuConfirmDelete: vi.fn(),
    setProfileDrawerBounds: vi.fn(),
    setProfileNameDraft: vi.fn(),
    setProfileIconDraft: vi.fn(),
    setProfileDrawerOpen: vi.fn(),
    setProfileSaving: vi.fn(),
    profileReturnFocus: vi.fn(),
    setPanelOpen: vi.fn(),
    setDraftChecked: vi.fn(),
    setDraftCategory: vi.fn(),
    setDraftKeyword: vi.fn(),
    setDragId: vi.fn(),
    setNewModelName: vi.fn(),
    setModelAddOpen: vi.fn(),
    setMapCategory: vi.fn(),
    alert: vi.fn(),
    confirm: vi.fn(() => true),
  } as unknown as ChannelActionPorts
  const state: ChannelActionState = {
    selectedId: 'c1',
    form: { name: '服务', protocol: 'mock', baseUrl: ' https://api ', enabled: true },
    selected: { id: 'c1', name: '服务', icon: null } as unknown as Channel,
    selectedKeyGroups: [
      { id: 'g1', name: '主 Key', priority: 1, createdAt: 1, models: [], modelCache: [] },
    ] as unknown as ChannelCredentialGroup[],
    activeGroup: { id: 'g1', name: '主 Key' } as unknown as ChannelCredentialGroup,
    activeModels: [] as readonly ModelCapability[],
    activeModelCache: [] as readonly ModelCapability[],
    channelList,
    catalog: {
      all: [
        { id: 'hidden-one', status: 'ready', kind: 'hidden' },
        { id: 'mock', status: 'ready', kind: 'offline' },
      ],
    } as unknown as ProtocolCatalog,
    hiddenBuiltinProtocolIds: new Set(['hidden-one']),
    draftChecked: new Set(['image-2']),
    dragId: 'c1',
    profileNameDraft: '新名称',
    profileIconDraft: 'data:image/png;base64,x',
    newModelName: '模型',
    newModelCategory: 'image',
    newModelVendor: 'openai',
    platform: {} as ChannelActionState['platform'],
    ...overrides,
  }
  return { actions: createChannelActions(ports), state, ports, channels, calls }
}

describe('channelActionCoordinator', () => {
  it('创建渠道时跳过隐藏协议，并重置筛选和选中项', async () => {
    const { actions, state, ports, channels } = harness()
    await actions.create(state)
    expect(channels.create).toHaveBeenCalledWith({
      name: '新建服务',
      protocol: 'mock',
      baseUrl: '',
    })
    expect(ports.setChannelFilter).toHaveBeenCalledWith('all')
    expect(ports.setChannelSearch).toHaveBeenCalledWith('')
    expect(ports.setSelectedId).toHaveBeenCalledWith('new')
  })

  it('启用失败回滚表单值并保留的错误文案', async () => {
    const { actions, state, ports, channels } = harness()
    channels.setEnabled.mockRejectedValueOnce(new Error('保存失败'))
    await actions.setEnabled(state, true)
    expect(ports.setForm).toHaveBeenNthCalledWith(1, { enabled: true })
    expect(ports.setForm).toHaveBeenNthCalledWith(2, { enabled: false })
    expect(ports.alert).toHaveBeenCalledWith('保存失败')
  })

  it('验证、探测、拉模型均先落库再调用 store，并保持忙碌状态顺序', async () => {
    for (const action of ['verify', 'detect', 'refresh'] as const) {
      const { actions, state, ports, channels, calls } = harness()
      ports.setBusy = vi.fn((value) => calls.push(`busy:${value}`))
      channels.update = vi.fn(async () => {
        calls.push('persist')
        return state.selected as never
      })
      const storeAction = action === 'refresh'
        ? channels.refreshModels
        : action === 'detect'
          ? channels.detectProtocol
          : channels.verify
      ;(storeAction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        calls.push(action)
        return action === 'detect' ? 'openai-compatible' : undefined
      })
      await actions[action](state)
      expect(calls.slice(0, 4)).toEqual(['busy:true', 'persist', action, 'busy:false'])
      expect(ports.setVerifiedFor).toHaveBeenCalledWith({
        channelId: 'c1',
        protocol: 'mock',
        source: action === 'refresh' ? 'models' : action,
      })
      if (action === 'detect') expect(ports.setForm).toHaveBeenCalledWith({ protocol: 'openai-compatible' })
    }
  })

  it('抽屉保存先置忙，成功后刷新名称/图标并关闭，finally 解锁', async () => {
    const { actions, state, ports, calls } = harness()
    ports.setProfileSaving = vi.fn((value) => calls.push(`saving:${value}`))
    await actions.saveProfileDrawer(state)
    expect(ports.setForm).toHaveBeenCalledWith({ name: '新名称' })
    expect(ports.setProfileDrawerOpen).toHaveBeenCalledWith(false)
    expect(calls).toEqual(['saving:true', 'saving:false'])
  })

  it('内置渠道不删除；确认取消不删 Key 分组或模型', async () => {
    const { actions, state, ports, channels } = harness()
    ports.confirm = vi.fn(() => false)
    await actions.remove(state, 'ch_builtin_runninghub')
    await actions.removeKeyGroup(state)
    await actions.removeGlobalModel('模型')
    expect(channels.remove).not.toHaveBeenCalled()
    expect(channels.removeCredentialGroup).not.toHaveBeenCalled()
    expect(channels.removeGlobalModel).not.toHaveBeenCalled()
  })

  it('Key 分组删除成功选中下一组，失败仍解锁并提示', async () => {
    const { actions, state, ports, channels, calls } = harness({
      selectedKeyGroups: [
        { id: 'g1', name: '主 Key' },
        { id: 'g2', name: '备用 Key' },
      ] as unknown as ChannelCredentialGroup[],
    })
    ports.setBusy = vi.fn((value) => calls.push(`busy:${value}`))
    await actions.removeKeyGroup(state)
    expect(ports.setActiveGroupId).toHaveBeenCalledWith('g2')
    expect(calls).toEqual(['busy:true', 'busy:false'])
    channels.removeCredentialGroup.mockRejectedValueOnce(new Error('删不掉'))
    await expect(actions.removeKeyGroup(state)).resolves.toBeUndefined()
    expect(ports.alert).toHaveBeenCalledWith('删不掉')
    expect(ports.setBusy).toHaveBeenLastCalledWith(false)
  })

  it('模型应用和渠道拖动保留既有排序与 busy/finally 顺序', async () => {
    const { actions, state, ports, channels, calls } = harness()
    ports.setBusy = vi.fn((value) => calls.push(`busy:${value}`))
    await actions.applyDraft(state)
    expect(channels.setModels).toHaveBeenCalledWith('c1', [], 'g1')
    expect(ports.setPanelOpen).toHaveBeenCalledWith(false)
    await actions.dropOnChannel(state, 'c2')
    expect(channels.reorder).toHaveBeenCalledWith(['c2', 'c1'])
    expect(calls).toEqual(['busy:true', 'busy:false'])
  })
})
