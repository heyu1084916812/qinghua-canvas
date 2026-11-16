import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import { createMemoryPlatform } from '../../platform/memory'
import { SettingsChannelQuickTest } from './SettingsChannelQuickTest'

/**
 * 「快速测试」块的静态形态（#1117）：费用说明要在、输入框与「运行」要在、
 * 没勾模型时给引导而不是一个点不动的按钮。
 */

const store = {} as ChannelStore
const platform = createMemoryPlatform()

function channel(models: { id: string; category: string }[]): Channel {
  return {
    id: 'ch-rh',
    name: 'RunningHub',
    icon: null,
    protocol: 'runninghub-api',
    baseUrl: 'https://www.runninghub.cn',
    models,
    credentialGroups: [],
  } as unknown as Channel
}

describe('渠道快速测试块', () => {
  it('有模型时：费用说明 + 输入框 + 模型下拉 + 运行按钮', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsChannelQuickTest, {
        channel: channel([{ id: 'GPT Image 2', category: 'image' }]),
        channels: store,
        platform,
      }),
    )
    expect(html).toContain('data-channel-quick-test="ch-rh"')
    expect(html).toContain('快速测试')
    expect(html).toContain('会调用正式生成接口并产生费用')
    expect(html).toContain('data-quick-test-input')
    expect(html).toContain('data-quick-test-model')
    expect(html).toContain('data-choice-picker="channel-quick-test-model"')
    expect(html).not.toContain('<select')
    expect(html).toContain('data-quick-test-run')
  })

  it('没勾模型时给一句引导，不摆一个点不动的运行按钮', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsChannelQuickTest, {
        channel: channel([]),
        channels: store,
        platform,
      }),
    )
    expect(html).toContain('还没勾选模型')
    expect(html).not.toContain('data-quick-test-run')
  })
})
