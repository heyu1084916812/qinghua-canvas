import { describe, expect, it, vi } from 'vitest'
import { createProtocolActions, type ProtocolActionPorts, type ProtocolActionState } from './protocolActionCoordinator'

const imported = {
  schema: 'qinghua.protocol/v1' as const,
  id: 'my-relay',
  name: '我的中转站',
  short: '中转',
  versionPath: '/api/v3',
  capabilities: ['chat' as const],
  recipe: {
    version: 1 as const,
    auth: { kind: 'bearer' as const },
    models: { kind: 'static' as const, items: [] },
  },
} as unknown as import('../../../domain/project/protocolRecipe').DeclarativeProtocolPackage

function harness(overrides: Partial<ProtocolActionState> = {}) {
  const channels = {
    createCustomProtocol: vi.fn(async (input: { id: string }) => ({
      ok: true as const,
      value: { id: input.id, name: '我的中转站', defaultBaseUrl: 'https://relay.example/v1' },
    })),
    update: vi.fn(async () => ({})),
    removeCustomProtocol: vi.fn(async () => {}),
    removeBuiltinProtocol: vi.fn(async () => {}),
    restoreBuiltinProtocols: vi.fn(async () => {}),
  }
  const files = {
    saveFile: vi.fn(async () => {}),
    saveFileWithResult: vi.fn(async () => 'saved' as const),
  }
  const ports: ProtocolActionPorts = {
    channels: channels as never,
    platform: { files } as never,
    setCatalogVersion: vi.fn(),
    setProtocol: vi.fn(),
    setBaseUrl: vi.fn(),
    setNpImportText: vi.fn(),
    setNpImported: vi.fn(),
    setNpError: vi.fn(),
    setNpNotice: vi.fn(),
    setProtoRemoveError: vi.fn(),
    setProtoManageNotice: vi.fn(),
    setNewProtoOpen: vi.fn(),
  }
  const state: ProtocolActionState = {
    selectedId: 'c1',
    protocol: 'mock',
    baseUrl: 'https://api.example/v1',
    catalog: {
      all: [
        { id: 'mock', defaultBaseUrl: 'https://api.example/v1' },
        { id: 'yuli', defaultBaseUrl: 'https://yuli.example/v1' },
      ],
    } as ProtocolActionState['catalog'],
    npImportText: JSON.stringify(imported),
    npImported: imported,
    newProtoOpen: false,
    ...overrides,
  }
  return { actions: createProtocolActions(ports), state, ports, channels, files }
}

describe('protocolActionCoordinator', () => {
  it('切换协议保留用户手填地址，并异步落库当前表单', () => {
    const { actions, state, ports, channels } = harness({ baseUrl: 'https://custom.example/v1' })
    actions.handleProtocolChange(state, 'yuli')
    expect(ports.setProtocol).toHaveBeenCalledWith('yuli')
    expect(ports.setBaseUrl).not.toHaveBeenCalled()
    expect(channels.update).toHaveBeenCalledWith('c1', {
      protocol: 'yuli',
      baseUrl: 'https://custom.example/v1',
    })
  })

  it('切换站点协议时只替换上一条默认地址，不覆盖手工地址', () => {
    const { actions, state, ports } = harness()
    actions.handleProtocolChange(state, 'yuli')
    expect(ports.setBaseUrl).toHaveBeenCalledWith('https://yuli.example/v1')
  })

  it('id 冲突最多重试 20 次，仍失败时返回校验结果', async () => {
    const { actions, state, channels } = harness()
    channels.createCustomProtocol.mockResolvedValue({
      ok: false,
      field: 'id',
      reason: '这个 id 已被占用',
    } as never)
    const result = await actions.createWithUniqueId(state, {
      idHint: '我的中转站',
      name: '我的中转站',
      short: '中转',
      capabilities: ['chat'],
      versionPath: '/v1',
    })
    expect(channels.createCustomProtocol).toHaveBeenCalledTimes(21)
    expect(result).toMatchObject({ ok: false, field: 'id' })
  })

  it('保存导入包先绑定目录和渠道，再清空草稿与打开态', async () => {
    const { actions, state, ports, channels } = harness()
    await actions.saveImportedProtocol(state)
    expect(channels.createCustomProtocol).toHaveBeenCalledTimes(1)
    expect(channels.update).toHaveBeenCalledWith('c1', {
      protocol: expect.stringMatching(/^custom-|my-relay/),
      baseUrl: 'https://api.example/v1',
    })
    expect(ports.setNpImportText).toHaveBeenCalledWith('')
    expect(ports.setNpImported).toHaveBeenCalledWith(null)
    expect(ports.setNewProtoOpen).toHaveBeenCalledWith(false)
    expect(ports.setNpNotice).toHaveBeenCalledWith('已导入并选中「我的中转站」')
  })

  it('解析失败清空导入草稿并写出领域错误', () => {
    const { actions, state, ports } = harness({ npImportText: 'not-json', npImported: null })
    expect(actions.checkImportedProtocol(state)).toBeNull()
    expect(ports.setNpImported).toHaveBeenCalledWith(null)
    expect(ports.setNpError).toHaveBeenCalledWith(expect.any(String))
  })

  it('下载取消不报成功；保存失败写回错误且不报成功', async () => {
    const { actions, ports, files } = harness()
    files.saveFileWithResult.mockResolvedValueOnce('cancelled' as never)
    await actions.downloadProtocolTemplate()
    expect(ports.setProtoManageNotice).toHaveBeenCalledWith('')
    const { saveFileWithResult } = files
    ;(saveFileWithResult as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('用户取消'))
    await actions.saveDownload('{}', 'reference.json')
    expect(ports.setProtoRemoveError).toHaveBeenCalledWith('用户取消')
  })

  it('删除自定义协议先刷当前渠道协议，失败只写错误；恢复成功刷新目录', async () => {
    const { actions, state, ports, channels } = harness()
    await actions.removeProtocol(state, {
      id: 'custom-relay',
      name: '中转',
      kind: 'custom',
    } as never)
    expect(channels.update).toHaveBeenCalledWith('c1', {
      protocol: 'mock',
      baseUrl: 'https://api.example/v1',
    })
    expect(channels.removeCustomProtocol).toHaveBeenCalledWith('custom-relay')
    expect(ports.setProtoManageNotice).toHaveBeenCalledWith('已删除「中转」')
    channels.removeBuiltinProtocol.mockRejectedValueOnce(new Error('仍被引用'))
    await actions.removeProtocol(state, { id: 'yuli', name: '玉玉', kind: 'station' } as never)
    expect(ports.setProtoRemoveError).toHaveBeenCalledWith('仍被引用')
    await actions.restoreBuiltinProtocols()
    expect(ports.setProtoManageNotice).toHaveBeenCalledWith('已恢复全部站点协议')
  })
})
