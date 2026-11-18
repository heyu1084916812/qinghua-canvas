import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Channel } from '../../domain/project/channel'
import type { WorkflowEntry, WorkflowParamField } from '../../domain/project/workflowParams'
import { WorkflowEntryGrid } from './WorkflowEntryGrid'
import { workflowChannelLabel, workflowChannelsOf } from './WorkflowsPage'
import source from './WorkflowsPage.tsx?raw'

const ch = (id: string, baseUrl: string, protocol = 'runninghub-api', name = id) => ({ id, name, baseUrl, protocol }) as unknown as Channel
const entry = (id: string, kind: 'app' | 'workflow', patch: Partial<WorkflowEntry> = {}): WorkflowEntry => ({
  id, kind, title: `条目 ${id}`, provider: 'runninghub', fetchedAt: 1, fields: [], ...patch,
})
const noop = () => {}

describe('AI 应用 / 工作流页（#1131）', () => {
  it('只列 RunningHub 渠道；按地址认国内站 / 国际站，自建地址用渠道名', () => {
    const list = workflowChannelsOf([
      ch('ch_builtin_runninghub', 'https://www.runninghub.cn'),
      ch('ch_builtin_agnes', 'https://x', 'openai-compatible'),
      ch('ch_builtin_runninghub_global', 'https://www.runninghub.ai'),
      ch('mine', 'https://proxy.example', 'runninghub-api', '我的反代'),
    ])
    expect(list.map((item) => item.id)).toEqual(['ch_builtin_runninghub', 'ch_builtin_runninghub_global', 'mine'])
    expect(list.map(workflowChannelLabel)).toEqual(['国内站', '国际站', '我的反代'])
  })

  it('卡片：名称 / 备注（无备注写路由）/ 参数计数 / 删除；空列表给导入引导', () => {
    const field: WorkflowParamField = { id: '1::a', nodeId: '1', fieldName: 'a', type: 'text', label: 'a', value: '', enabled: true, group: '', options: [], min: null, max: null, step: null, seed: false, required: false, mediaOrder: 0 }
    const html = renderToStaticMarkup(
      createElement(WorkflowEntryGrid, {
        tab: 'workflow',
        entries: [entry('190', 'workflow', { fields: [field, { ...field, id: '2::b', enabled: false }] }), entry('191', 'workflow', { note: '人像修复' })],
        ready: true, market: null, busy: false,
        onCloseMarket: noop, onAddFromMarket: noop, onOpen: noop, onRemove: noop,
      }),
    )
    expect(html).toContain('data-workflows-card="190"')
    expect(html).toContain('/run/workflow/190')
    expect(html).toContain('2 个参数 · 已暴露 1')
    expect(html).toContain('人像修复')
    expect(html).toContain('data-workflows-card-remove="191"')
    const empty = renderToStaticMarkup(
      createElement(WorkflowEntryGrid, { tab: 'app', entries: [], ready: true, market: null, busy: false, onCloseMarket: noop, onAddFromMarket: noop, onOpen: noop, onRemove: noop }),
    )
    expect(empty).toContain('还没有AI 应用')
  })
})

/**
 * 对账 #1152（用户 2026-11-18 图四）：这条页面的三处接线只在渲染里才体现，
 * 纯函数测不到 —— 用源码断言钉住，谁改回去会立刻红。
 */
describe('渠道入口与站点控件（#1152）', () => {
  it('★★ 「渠道与 Key」直接开设置浮层并落在该渠道，不再跳 /settings 整页路由', () => {
    expect(source).toContain('openChannelSettings(channel.id)')
    expect(source).not.toContain('/settings?channel=')
  })

  it('★★ 只剩一个 Key 入口：横幅不再带按钮，工具条那枚仍常驻', () => {
    expect(source.match(/onClick=\{onOpenSettings\}/g)).toHaveLength(1)
    expect(source.match(/data-workflows-channel-settings/g)).toHaveLength(1)
  })

  it('★ 站点切换换成项目统一的选择器，不再是自画的分段按钮', () => {
    expect(source).toContain('<ChoicePicker')
    expect(source).not.toContain('styles.siteOn')
  })
})
