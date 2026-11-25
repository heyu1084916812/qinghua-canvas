import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import {
  useChannelMappingDraft,
  type ChannelMappingDraftSource,
} from './useChannelMappingDraft'

type Draft = ReturnType<typeof useChannelMappingDraft>

function renderDraft(overrides: Partial<ChannelMappingDraftSource> = {}) {
  const channels = {
    globalModelsOf: vi.fn((category: string) => [{ id: `${category}-model` }]),
    addGlobalModel: vi.fn(async () => ({ category: 'chat' })),
    removeGlobalModel: vi.fn(async () => {}),
    renameGlobalModel: vi.fn(async () => {}),
    setModelBinding: vi.fn(async () => {}),
    setModelUncommon: vi.fn(async () => {}),
  }
  const setMapSaveNotice = vi.fn()
  const source: ChannelMappingDraftSource = {
    channels: channels as never,
    selectedId: 'c1',
    activeGroupId: 'g1',
    customModels: [],
    uncommonModelIds: [],
    setMapSaveNotice,
    alertMessage: vi.fn(),
    confirmMessage: vi.fn(() => true),
    ...overrides,
  }
  const result: { current: Draft } = { current: undefined as unknown as Draft }
  function Probe() {
    result.current = useChannelMappingDraft(source)
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
  return { draft: result, rerender, channels, source, setMapSaveNotice }
}

describe('模型映射卡的草稿态', () => {
  it('前端模型目录按四档铺开（对话/图片/视频/音频都各取一次）', () => {
    const { draft, channels } = renderDraft()
    expect(draft.current.allGlobalModels).toHaveLength(4)
    expect(channels.globalModelsOf).toHaveBeenCalledTimes(4)
    expect(channels.globalModelsOf).toHaveBeenCalledWith('audio', true)
  })

  it('新增前端模型按表单当前分类保存，成功后清空名称并收起新增表单', async () => {
    const { draft, rerender, channels } = renderDraft()
    act(() => {
      draft.current.setNewModelName('6.1')
      draft.current.setNewModelCategory('chat')
      draft.current.setModelAddOpen(true)
      draft.current.setModelFormOpen(true)
    })
    rerender()
    await act(async () => {
      await draft.current.addGlobalModel()
    })
    rerender()
    expect(channels.addGlobalModel).toHaveBeenCalledWith({
      name: '6.1',
      category: 'chat',
      vendor: 'openai',
    })
    expect(draft.current.newModelName).toBe('')
    expect(draft.current.modelAddOpen).toBe(true)
    expect(draft.current.modelFormOpen).toBe(false)
  })

  it('关闭目录时收起新增表单，避免下次打开残留', () => {
    const { draft, rerender } = renderDraft()
    act(() => {
      draft.current.setModelAddOpen(true)
      draft.current.setModelFormOpen(true)
    })
    rerender()
    expect(draft.current.modelFormOpen).toBe(true)

    act(() => {
      draft.current.setModelAddOpen(false)
    })
    rerender()
    expect(draft.current.modelAddOpen).toBe(false)
    expect(draft.current.modelFormOpen).toBe(false)
  })

  it('删除前端模型要先确认；取消就一个接口都不发', async () => {
    const confirmMessage = vi.fn(() => false)
    const { draft, channels } = renderDraft({ confirmMessage })
    await act(async () => {
      await draft.current.removeGlobalModel('6.1')
    })
    expect(confirmMessage).toHaveBeenCalledWith(expect.stringContaining('6.1'))
    expect(channels.removeGlobalModel).not.toHaveBeenCalled()
  })

  it('重命名只改自定义模型显示名，失败原文交给提示层', async () => {
    const alertMessage = vi.fn()
    const { draft, channels } = renderDraft({ alertMessage })
    await act(async () => {
      await draft.current.renameGlobalModel('custom-id', 'New Display Name')
    })
    expect(channels.renameGlobalModel).toHaveBeenCalledWith(
      'custom-id',
      'New Display Name',
    )

    channels.renameGlobalModel.mockRejectedValueOnce(new Error('名称重复'))
    await act(async () => {
      await draft.current.renameGlobalModel('custom-id', 'Duplicate')
    })
    expect(alertMessage).toHaveBeenCalledWith('名称重复')
  })

  it('绑定成功写「已保存」，失败写错误原文，都不会抛到界面外', async () => {
    const { draft, rerender, channels, setMapSaveNotice } = renderDraft()
    await act(async () => {
      await draft.current.bindModel('up-1', '逻辑模型')
    })
    expect(channels.setModelBinding).toHaveBeenCalledWith('c1', 'up-1', '逻辑模型', 'g1')
    expect(setMapSaveNotice).toHaveBeenLastCalledWith({ id: '逻辑模型', tone: 'ok', text: '已保存' })

    channels.setModelBinding.mockRejectedValueOnce(new Error('上游不存在'))
    await act(async () => {
      await draft.current.bindModel('up-2', '逻辑模型2')
    })
    rerender()
    expect(setMapSaveNotice).toHaveBeenLastCalledWith({
      id: '逻辑模型2',
      tone: 'error',
      text: '上游不存在',
    })
  })

  it('常用 / 不常用开关直接转给渠道仓储', () => {
    const { draft, channels } = renderDraft()
    act(() => {
      draft.current.setModelUncommon('m1', true)
    })
    expect(channels.setModelUncommon).toHaveBeenCalledWith('m1', true)
  })
})
