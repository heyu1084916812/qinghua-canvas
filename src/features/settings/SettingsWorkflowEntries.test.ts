import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import { SettingsWorkflowEntries } from './SettingsWorkflowEntries'

const channel = {
  id: 'ch-rh',
  name: 'RunningHub',
  icon: null,
  protocol: 'runninghub-api',
  baseUrl: 'https://www.runninghub.cn',
  models: [],
  credentialGroups: [],
} as unknown as Channel

/**
 * 服务端静态渲染只覆盖**初始形态**：数据要等 effect 里的存储读取与网络请求，
 * 那些由 `workflowEntryStore.test.ts` / `runninghubMarket.test.ts` 单独钉。
 * 这里钉的是「入口真的在页面上」——模块治理的 test 证据也指这一条。
 */
describe('SettingsWorkflowEntries', () => {
  it('渲染出标题、市场入口、手填 workflowId 与空态说明', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsWorkflowEntries, {
        channel,
        channels: {} as ChannelStore,
        platform: createMemoryPlatform(),
      }),
    )
    expect(html).toContain('data-workflow-entries')
    expect(html).toContain('工作流条目')
    expect(html).toContain('只列「运行时长费用」那批')
    expect(html).toContain('从市场添加')
    expect(html).toContain('workflowId')
    expect(html).toContain('还没有工作流条目')
    /* 市场面板默认收起（点按钮才拉目录） */
    expect(html).not.toContain('data-workflow-market')
  })
})
