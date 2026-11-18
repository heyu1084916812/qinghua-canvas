import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import {
  useChannelProtocolDraft,
  type ChannelProtocolDraftSource,
} from './useChannelProtocolDraft'

type Draft = ReturnType<typeof useChannelProtocolDraft>

/** 与 `DECLARATIVE_PROTOCOL_TEMPLATE` 同形，解析器只认顶层 chat / image / video 块 */
const importedPackage = {
  schema: 'qinghua.protocol/v1',
  id: 'my-relay',
  name: '我的中转站',
  short: '中转',
  versionPath: '/api/v3',
  auth: { type: 'bearer' },
  models: {
    request: { method: 'GET', path: '/models' },
    items: '$.data[*]',
    id: '$.id',
    category: 'chat',
  },
  chat: {
    request: {
      method: 'POST',
      path: '/chat/completions',
      body: { model: '{{model}}', messages: { $var: 'messages' } },
    },
    response: { text: '$.choices[0].message.content' },
  },
}

function renderDraft(overrides: Partial<ChannelProtocolDraftSource> = {}) {
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
  const source: ChannelProtocolDraftSource = {
    channels: channels as never,
    platform: { files } as never,
    selectedId: 'c1',
    protocol: 'mock',
    baseUrl: 'https://api.example/v1',
    catalog: {
      all: [
        { id: 'mock', defaultBaseUrl: 'https://api.example/v1' },
        { id: 'yuli', defaultBaseUrl: 'https://yuli.example/v1' },
      ],
    } as never,
    setProtocol: vi.fn(),
    setBaseUrl: vi.fn(),
    setCatalogVersion: vi.fn(),
    ...overrides,
  }
  const result: { current: Draft } = { current: undefined as unknown as Draft }
  function Probe() {
    result.current = useChannelProtocolDraft(source)
    return null
  }
  let root!: TestRenderer.ReactTestRenderer
  act(() => {
    root = TestRenderer.create(createElement(Probe))
  })
  const rerender = () =>
    act(() => {
      root.update(createElement(Probe))
    })
  return { draft: result, rerender, source, channels, files }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('连接卡的协议草稿态', () => {
  it('打开导入面板时清空上一次的正文 / 解析结果 / 提示', () => {
    const { draft, rerender } = renderDraft()
    act(() => draft.current.setNpImportText('垃圾内容'))
    rerender()
    expect(draft.current.npImportText).toBe('垃圾内容')
    act(() => draft.current.actions.toggleNewProtocol())
    rerender()
    expect(draft.current.newProtoOpen).toBe(true)
    expect(draft.current.npImportText).toBe('')
    expect(draft.current.npImported).toBeNull()
    expect(draft.current.npError).toBe('')
  })

  it('导入非法文件只写错误、不留半成品解析结果', async () => {
    const { draft, rerender } = renderDraft()
    await act(async () => {
      await draft.current.actions.handleImportProtocolFile({
        text: async () => 'not-json',
      } as unknown as File)
    })
    rerender()
    expect(draft.current.npImported).toBeNull()
    expect(draft.current.npError).not.toBe('')
  })

  it('合法声明解析成功后能直接保存并回执', async () => {
    const { draft, rerender, channels } = renderDraft()
    act(() => draft.current.setNpImportText(JSON.stringify(importedPackage)))
    rerender()
    act(() => {
      draft.current.actions.checkImportedProtocol()
    })
    rerender()
    expect(draft.current.npImported).toMatchObject({ name: '我的中转站' })
    await act(async () => {
      await draft.current.actions.handleSaveImportedProtocol()
    })
    rerender()
    expect(channels.createCustomProtocol).toHaveBeenCalledTimes(1)
    expect(draft.current.npNotice).toContain('我的中转站')
    expect(draft.current.newProtoOpen).toBe(false)
  })

  it('切协议：只替换上一条默认地址，不覆盖手填地址', () => {
    const { draft, source } = renderDraft()
    act(() => draft.current.actions.handleProtocolChange('yuli'))
    expect(source.setProtocol).toHaveBeenCalledWith('yuli')
    expect(source.setBaseUrl).toHaveBeenCalledWith('https://yuli.example/v1')
    expect(source.channels.update).toHaveBeenCalledWith('c1', {
      protocol: 'yuli',
      baseUrl: 'https://yuli.example/v1',
    })
  })

  it('模板下载回执 2.6s 后自动消失', async () => {
    vi.useFakeTimers()
    const { draft, rerender } = renderDraft()
    await act(async () => {
      await draft.current.actions.downloadProtocolTemplate()
    })
    rerender()
    expect(draft.current.protoManageNotice).toBe('已下载协议模板')
    act(() => {
      vi.advanceTimersByTime(2600)
    })
    rerender()
    expect(draft.current.protoManageNotice).toBe('')
  })
})
