import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import type { WorkflowEntry } from '../../../../domain/project/workflowParams'
import { WorkflowParameterControls } from './WorkflowParameterControls'
import { findWorkflowSourceRow, isWorkflowPanelModel, runninghubChannelIds, type WorkflowPanelSources } from './workflowPanelSources'

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
/** 模型菜单由面板传入（#1133 `SourceModelMenu`），这里只钉它被放在行首 */
const MODEL_PICKER = createElement('span', { 'data-stub-model-picker': '' })

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
        modelPicker: MODEL_PICKER,
        openPicker: null,
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    /* 条目 chip = 面板传入的模型菜单（换条目 / 换回 API / CLI 都在那里），这里不再另画条目下拉 */
    expect(html.startsWith('<span data-stub-model-picker')).toBe(true)
    expect(html).not.toContain('data-param-chip="model"')
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
})

describe('AI 应用的参数行', () => {
  it('`app:` 模型也能认出条目（面板按条目渲染，而不是按前缀分支）', () => {
    const app: WorkflowEntry = { ...ENTRY, id: '1877265245566922753', title: '风格迁移', kind: 'app' }
    const html = renderToStaticMarkup(
      createElement(WorkflowParameterControls, {
        data: { ...generationSpec.createDefaultData(), model: 'app:1877265245566922753', channelId: 'ch-rh' },
        sources: { channels: [{ id: 'ch-rh', name: 'RunningHub', protocol: 'runninghub-api', entries: [app] }] },
        modelPicker: MODEL_PICKER,
        openPicker: null,
        onTogglePicker: noop,
        onClosePicker: noop,
        onEvent: noop,
      }),
    )
    expect(html).toContain('data-param-chip="workflowParams"')
    /* #1128：应用的提交体不吃实例规格，chip 不显示（#1127 M1） */
    expect(html).not.toContain('data-param-chip="workflowInstance"')
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

describe('#1128 条目下拉 / 找不到条目', () => {
  const APP: WorkflowEntry = { ...ENTRY, id: '1877265245566922753', kind: 'app', title: '风格迁移' }
  const BOTH: WorkflowPanelSources = {
    channels: [{ id: 'ch-rh', name: 'RunningHub', protocol: 'runninghub-api', entries: [ENTRY, APP] }],
  }
  const render = (data: ReturnType<typeof workflowData>, sources = BOTH) =>
    renderToStaticMarkup(
      createElement(WorkflowParameterControls, { data, sources, modelPicker: MODEL_PICKER, openPicker: null, onTogglePicker: noop, onClosePicker: noop, onEvent: noop }),
    )

  it('★ H3：workflow:X 条目不在 → 写「条目不存在」，不借用别的条目的标题与参数', () => {
    const html = render({ ...workflowData(), model: 'workflow:404' })
    expect(html).toContain('data-workflow-missing')
    expect(html).toContain('这个条目已被删除或不在当前渠道')
    expect(html).toContain('title="这个条目已被删除或不在当前渠道，换一个条目再生成"')
    expect(html).not.toContain('视频超分与补帧</')
    expect(html).not.toContain('data-param-chip="workflowParams"')
    expect(findWorkflowSourceRow(BOTH, 'workflow:404', 'ch-rh')).toBeNull()
  })

  it('★ H3：渠道推荐的 app: 模型（没导入）不进工作流模式；导入过的才进', () => {
    expect(isWorkflowPanelModel(BOTH, 'app:999', 'ch-rh')).toBe(false)
    expect(isWorkflowPanelModel(BOTH, `app:${APP.id}`, 'ch-rh')).toBe(true)
    expect(isWorkflowPanelModel(BOTH, 'workflow:404', 'ch-rh')).toBe(true)
    expect(isWorkflowPanelModel(BOTH, 'GPT Image 2', 'ch-rh')).toBe(false)
    /** 同 id 的应用不能冒充工作流 */
    expect(findWorkflowSourceRow(BOTH, `workflow:${APP.id}`, 'ch-rh')).toBeNull()
  })

  it('AI 应用不显示 24G/48G（应用提交体不吃实例规格）', () => {
    const html = render({ ...workflowData(), model: `app:${APP.id}` })
    expect(html).not.toContain('data-workflow-missing')
    expect(html).not.toContain('data-param-chip="workflowInstance"')
  })
})
