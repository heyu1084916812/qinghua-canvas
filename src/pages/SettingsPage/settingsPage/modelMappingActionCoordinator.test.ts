import { describe, expect, it, vi } from 'vitest'
import {
  createModelMappingActions,
  type ModelMappingPorts,
} from './modelMappingActionCoordinator'

function harness() {
  const channels = {
    setModelMapping: vi.fn(async () => {}),
    testModelMapping: vi.fn(async () => ({ status: 'ok' as const, message: '目录里有这个模型' })),
  }
  let selectedId: string | null = 'c1'
  let mapDrafts: Record<string, string> = { 'GPT Image 2': 'gpt-image-2' }
  const scheduled: Array<{ handler: () => void; delay: number }> = []
  const setMapTests = vi.fn(
    (update: (previous: Record<string, never>) => Record<string, never>) => update({}),
  )
  const ports: ModelMappingPorts = {
    channels: channels as never,
    selectedId: () => selectedId,
    activeGroupId: () => 'g1',
    timers: new Map(),
    setMapDrafts: (update) => {
      mapDrafts = update(mapDrafts)
    },
    setMapSaveNotice: vi.fn(),
    setMapTests: setMapTests as never,
    setTimeout: (handler, delay) => {
      scheduled.push({ handler, delay })
      return scheduled.length
    },
    clearTimeout: vi.fn(),
  }
  return {
    actions: createModelMappingActions(ports),
    channels,
    ports,
    setMapTests,
    scheduled,
    setSelectedId: (value: string | null) => {
      selectedId = value
    },
    drafts: () => mapDrafts,
  }
}

describe('modelMappingActionCoordinator', () => {
  it('flush 清除同逻辑名定时器，成功后只删仍匹配的草稿并报告已保存', async () => {
    const { actions, channels, ports, drafts } = harness()
    ports.timers.set('GPT Image 2', 77)
    await actions.flush('GPT Image 2', 'gpt-image-2')
    expect(ports.clearTimeout).toHaveBeenCalledWith(77)
    expect(ports.timers.has('GPT Image 2')).toBe(false)
    expect(channels.setModelMapping).toHaveBeenCalledWith('c1', 'GPT Image 2', 'gpt-image-2')
    expect(drafts()).toEqual({})
    expect(ports.setMapSaveNotice).toHaveBeenCalledWith({
      id: 'GPT Image 2',
      tone: 'ok',
      text: '已保存',
    })
  })

  it('保存失败保留 error 文案，不清除草稿', async () => {
    const { actions, channels, ports, drafts } = harness()
    channels.setModelMapping.mockRejectedValueOnce(new Error('网络失败'))
    await actions.flush('GPT Image 2', 'gpt-image-2')
    expect(drafts()).toEqual({ 'GPT Image 2': 'gpt-image-2' })
    expect(ports.setMapSaveNotice).toHaveBeenCalledWith({
      id: 'GPT Image 2',
      tone: 'error',
      text: '网络失败',
    })
  })

  it('先改后改只留最后一个 600ms 定时器，旧定时器被清掉', async () => {
    const { actions, ports, scheduled } = harness()
    actions.schedule('GPT Image 2', 'first')
    actions.schedule('GPT Image 2', 'second')
    expect(scheduled.map((item) => item.delay)).toEqual([600, 600])
    expect(ports.clearTimeout).toHaveBeenCalledWith(1)
    expect(ports.timers.get('GPT Image 2')).toBe(2)
    scheduled[1].handler()
    await Promise.resolve()
    expect(ports.timers.has('GPT Image 2')).toBe(false)
  })

  it('测试映射按 checking → flush → store 测试 → 结果写回', async () => {
    const { actions, channels, setMapTests } = harness()
    await actions.test('GPT Image 2', 'gpt-image-2')
    expect(channels.setModelMapping).toHaveBeenCalledTimes(1)
    expect(channels.testModelMapping).toHaveBeenCalledWith('c1', 'GPT Image 2', 'gpt-image-2', 'g1')
    expect(setMapTests).toHaveBeenCalledTimes(2)
    const first = setMapTests.mock.calls[0][0] as unknown as (p: Record<string, unknown>) => Record<string, unknown>
    expect(first({})).toEqual({
      'GPT Image 2': { status: 'checking', message: '正在读取模型目录…' },
    })
  })

  it('未选渠道与 store 抛错路径都不写回成功状态', async () => {
    const { actions, channels, setMapTests, setSelectedId } = harness()
    setSelectedId(null)
    await actions.test('GPT Image 2', 'gpt-image-2')
    expect(channels.testModelMapping).not.toHaveBeenCalled()
    setSelectedId('c1')
    channels.testModelMapping.mockRejectedValueOnce(new Error('测试失败'))
    await actions.test('GPT Image 2', 'gpt-image-2')
    const last = setMapTests.mock.calls.at(-1)?.[0] as unknown as (p: Record<string, unknown>) => Record<string, unknown>
    expect(last({})).toEqual({
      'GPT Image 2': { status: 'error', message: '测试失败' },
    })
  })
})
