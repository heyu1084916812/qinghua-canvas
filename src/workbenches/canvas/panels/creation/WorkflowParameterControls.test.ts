import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import { WorkflowEntryLauncher, WorkflowParameterControls } from './WorkflowParameterControls'
import { runninghubChannelIds, type WorkflowPanelSources } from './workflowPanelSources'

/**
 * 工作流参数行（对账 #1105 / #1116）。
 *
 * 钉的是用户 2026-11-14 提的那几条：
 * 1. **不另设「运行」** —— 面板本来就有生成按钮；
 * 2. **不单列渠道** —— 条目 chip 前面就是渠道品牌图标；
 * 3. **不写花钱小字** —— 行上只留能点得动的东西；
 * 4. 参数摘要写的是**当前值**，不是「参数 N」这种计数。
 */

const ENTRY: WorkflowEntry = {
  id: '1997246493079834625',
  title: '视频超分与补帧',
  provider: 'runninghub',
  fetchedAt: 0,
  kind: 'workflow',
  fields: [
    {
      id: '16::video',
      nodeId: '16',
      fieldName: 'video',
      type: 'video',
      label: '源视频',
      value: '',
      enabled: true,
      group: 'Load',
      options: [],
      min: null,
      max: null,
      step: null,
      seed: false,
      required: true,
      mediaOrder: 1,
    },
    {
      id: '65::strength',
      nodeId: '65',
      fieldName: 'strength',
      type: 'number',
      label: '超分强度',
      value: '0.8',
      enabled: true,
      group: 'SeedVR2',
      options: [],
      min: 0,
      max: 1,
      step: 0.05,
      seed: false,
      required: false,
      mediaOrder: 0,
    },
  ],
}

const SOURCES: WorkflowPanelSources = {
  channels: [{ id: 'ch-rh', name: 'RunningHub', protocol: 'runninghub-api', entries: [ENTRY] }],
}

const noop = () => {}

function workflowData() {
  return {
    ...generationSpec.createDefaultData(),
    model: `workflow:${ENTRY.id}`,
    channelId: 'ch-rh',
  }
}

describe('工作流参数行', () => {
  it('只出现条目 / 实例 / 参数摘要，没有「运行」、渠道 chip 与花钱小字', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowParameterControls, {
        data: workflowData(),
        sources: SOURCES,
        openPicker: null,
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    expect(html).toContain('data-param-chip="model"')
    expect(html).toContain('视频超分与补帧')
    expect(html).toContain('data-param-chip="workflowInstance"')
    expect(html).toContain('data-param-chip="workflowParams"')
    /* 摘要写当前值（媒体字段写名字） */
    expect(html).toContain('源视频 · 0.8')
    /* 不再有这几样 */
    expect(html).not.toContain('运行')
    expect(html).not.toContain('data-param-chip="workflowChannel"')
    expect(html).not.toContain('必选 · 用上游')
    expect(html).not.toContain('扣积分')
  })

  it('条目列表里能换回普通模型（否则进了工作流就没有出口）', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowParameterControls, {
        data: workflowData(),
        sources: SOURCES,
        apiOptions: [{ value: 'GPT Image 2', label: 'GPT Image 2' }],
        openPicker: 'model',
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    expect(html).toContain('data-param-option="GPT Image 2"')
    expect(html).toContain('API 模型')
  })
})

describe('工作流入口 chip（API 模式下挑条目）', () => {
  it('有条目时画一枚「工作流」chip', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowEntryLauncher, {
        sources: SOURCES,
        openPicker: null,
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    expect(html).toContain('data-param-chip="workflowEntry"')
    expect(html).toContain('工作流')
  })

  it('没有来源（提示词面板 / 已在工作流模式）时不画', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowEntryLauncher, {
        sources: null,
        openPicker: null,
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    expect(html).toBe('')
  })

  it('AI 应用也在这条链路上：入口 chip 里能选到它', () => {
    const app: WorkflowEntry = {
      id: '1877265245566922753',
      title: '风格迁移',
      provider: 'runninghub',
      fetchedAt: 0,
      kind: 'app',
      fields: [],
    }
    const html = renderToStaticMarkup(
      createElement(WorkflowEntryLauncher, {
        sources: { channels: [{ id: 'ch-rh', name: 'RunningHub', protocol: 'runninghub-api', entries: [ENTRY, app] }] },
        openPicker: 'workflowEntry',
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    expect(html).toContain('data-param-option="ch-rh::app:1877265245566922753"')
    expect(html).toContain('风格迁移')
  })
})

describe('AI 应用的参数行', () => {
  it('`app:` 模型也能认出条目（面板按条目渲染，而不是按前缀分支）', () => {
    const app: WorkflowEntry = { ...ENTRY, id: '1877265245566922753', title: '风格迁移', kind: 'app' }
    const html = renderToStaticMarkup(
      createElement(WorkflowParameterControls, {
        data: { ...generationSpec.createDefaultData(), model: 'app:1877265245566922753', channelId: 'ch-rh' },
        sources: { channels: [{ id: 'ch-rh', name: 'RunningHub', protocol: 'runninghub-api', entries: [app] }] },
        openPicker: null,
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    expect(html).toContain('风格迁移')
    expect(html).toContain('data-param-chip="workflowInstance"')
  })
})

describe('要读条目的渠道 id', () => {
  it('只取 runninghub-api，且 id 原样（不带任何后缀）', () => {
    expect(
      runninghubChannelIds([
        { id: 'ch_builtin_runninghub', protocol: 'runninghub-api' },
        { id: 'ch_agnes', protocol: 'agnes' },
      ]),
    ).toEqual(['ch_builtin_runninghub'])
  })
})
