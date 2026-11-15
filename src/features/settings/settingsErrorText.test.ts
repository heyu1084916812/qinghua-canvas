import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import { createMemoryPlatform } from '../../platform/memory'
import { ChannelError } from '../../platform/channels/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** 渠道层抛 ChannelError（message 只是 `[channel] http`）——界面必须走 errorTextOf 翻成人话（审查 M4） */
const failure = vi.hoisted(() => ({ error: null as unknown }))
vi.mock('../../state/channel/channelQuickTest', async (original) => ({
  ...(await original<typeof import('../../state/channel/channelQuickTest')>()),
  runChannelQuickTest: vi.fn(async () => {
    throw failure.error
  }),
}))

const { SettingsChannelQuickTest } = await import('./SettingsChannelQuickTest')
const { SettingsWorkflowTestRun } = await import('./SettingsWorkflowTestRun')

const channel = {
  id: 'ch-rh', name: 'RunningHub', icon: null, protocol: 'runninghub-api', baseUrl: 'https://www.runninghub.cn',
  models: [{ id: 'workflow:1', category: 'image' }], credentialGroups: [],
} as unknown as Channel
const channels = { loadToken: async () => 'k', protocolCatalog: () => ({}) } as unknown as ChannelStore
const textOf = (renderer: TestRenderer.ReactTestRenderer) => JSON.stringify(renderer.toJSON())
const clickRun = async (renderer: TestRenderer.ReactTestRenderer, label: string) => {
  const button = renderer.root.findAll((node) => node.type === 'button' && node.children.includes(label))[0]!
  await act(async () => {
    button.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('设置页错误文案统一走 errorTextOf（#1130 M4）', () => {
  it('★ 快速测试：ChannelError(http) 显示上游原因，不显示 [channel] http', async () => {
    failure.error = new ChannelError({ kind: 'http', status: 404, body: '工作流不存在' })
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(createElement(SettingsChannelQuickTest, { channel, channels, platform: createMemoryPlatform() }))
    })
    const input = renderer.root.findAll((node) => node.type === 'textarea')[0]!
    act(() => input.props.onChange({ target: { value: '一只猫' } }))
    await clickRun(renderer, '运行')
    expect(textOf(renderer)).toContain('工作流不存在')
    expect(textOf(renderer)).not.toContain('[channel]')
  })

  it('★ 测试运行：网络层抛的普通对象 {kind:http} 不再显示 [object Object]', async () => {
    failure.error = { kind: 'http', status: 401, body: 'unauthorized' }
    const entry = { id: '1', kind: 'workflow' as const, title: 'w', provider: 'runninghub' as const, fields: [], fetchedAt: 1 }
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(createElement(SettingsWorkflowTestRun, { channel, entry, channels, platform: createMemoryPlatform() }))
    })
    await clickRun(renderer, '测试运行')
    expect(textOf(renderer)).not.toContain('[object Object]')
    expect(textOf(renderer)).not.toContain('[channel]')
    expect(textOf(renderer)).toMatch(/401|unauthorized|Key|鉴权/)
  })
})
