import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import { SettingsWorkflowManager } from './SettingsWorkflowManager'
import { WorkflowFieldEditor } from './WorkflowFieldEditor'

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
 * 这里钉的是「管理页真的在页面上、只有这一个入口」。
 */
describe('SettingsWorkflowManager', () => {
  it('收起态是一条入口（标题 + 已加条目数 + 进入管理）', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsWorkflowManager, {
        channel,
        channels: {} as ChannelStore,
        platform: createMemoryPlatform(),
      }),
    )
    expect(html).toContain('data-workflow-manager-entry')
    expect(html).toContain('AI 应用和工作流')
    expect(html).toContain('进入管理')
    expect(html).toContain('已添加 0 个应用 · 0 条工作流')
    /* 展开后的两栏与市场面板都不在收起态里（点进去才渲染、才拉目录） */
    expect(html).not.toContain('data-workflow-column')
    expect(html).not.toContain('data-workflow-market')
  })
})

describe('WorkflowFieldEditor（复刻 canvas-xiong 的参数暴露编辑器）', () => {
  const entry = {
    id: 'w1',
    title: 'Z-Image 文生图',
    provider: 'runninghub' as const,
    fetchedAt: 0,
    fields: [
      {
        id: '6::text',
        nodeId: '6',
        fieldName: 'text',
        type: 'textarea' as const,
        label: '提示词',
        value: '一只橘猫',
        enabled: true,
        group: 'CLIP',
        options: [],
        min: null,
        max: null,
        step: null,
        seed: false,
        required: true,
        mediaOrder: 0,
      },
      {
        id: '7::ratio',
        nodeId: '7',
        fieldName: 'ratio',
        type: 'select' as const,
        label: '比例',
        value: '16:9',
        enabled: false,
        group: 'Empty Latent',
        options: ['1:1', '16:9'],
        min: null,
        max: null,
        step: null,
        seed: false,
        required: false,
        mediaOrder: 0,
      },
    ],
  }

  it('左侧只预览已暴露字段；右侧按节点分组列出全部字段', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowFieldEditor, {
        entry,
        onSave: () => {},
        onClose: () => {},
      }),
    )
    expect(html).toContain('data-workflow-field-editor')
    /* 预览：已暴露的 textarea 出现在左栏 */
    expect(html).toContain('一只橘猫')
    /* 清单：两个分组、两个字段都在 */
    expect(html).toContain('data-workflow-group="CLIP"')
    expect(html).toContain('data-workflow-group="Empty Latent"')
    expect(html).toContain('data-workflow-field="7::ratio"')
    /* 批量操作在（默认全隐藏时的兜底） */
    expect(html).toContain('全部暴露')
    expect(html).toContain('全部隐藏')
  })

  it('条目设置页关掉预览栏时只剩字段清单（不出三栏窄条）', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowFieldEditor, {
        entry,
        showPreview: false,
        onSave: () => {},
        onClose: () => {},
      }),
    )
    expect(html).toContain('data-preview="off"')
    expect(html).not.toContain('data-workflow-preview')
    /* 清单仍在 */
    expect(html).toContain('data-workflow-field="7::ratio"')
  })

  it('空候选的常见字段会被补成下拉（采样器 / 比例这类）', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowFieldEditor, {
        entry: {
          ...entry,
          fields: [
            { ...entry.fields[1]!, fieldName: 'sampler_name', options: [], type: 'text' as const, id: '3::sampler_name' },
          ],
        },
        onSave: () => {},
        onClose: () => {},
      }),
    )
    expect(html).toContain('euler_ancestral')
  })
})
