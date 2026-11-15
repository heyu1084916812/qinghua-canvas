import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Channel } from '../../domain/project/channel'
import type { WorkflowEntry, WorkflowParamField } from '../../domain/project/workflowParams'
import { WorkflowEntryGrid } from './WorkflowEntryGrid'
import { workflowChannelLabel, workflowChannelsOf } from './WorkflowsPage'

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
