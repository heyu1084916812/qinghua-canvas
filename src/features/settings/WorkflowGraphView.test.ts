import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkflowParamField } from '../../domain/project/workflowParams'
import type { WorkflowGraph } from '../../domain/project/workflowGraph'
import { GRAPH_CONTROL_SELECTOR, shouldStartGraphDrag, WorkflowGraphView } from './WorkflowGraphView'

/**
 * 节点图（#1116 ②）的静态形态：节点按图快照画出来、暴露数按**草稿**算、
 * 弹层默认不出现（要点节点才出）。
 */

const fields: WorkflowParamField[] = [
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
    id: '24::frame_rate',
    nodeId: '24',
    fieldName: 'frame_rate',
    type: 'number',
    label: '帧率',
    value: '30',
    enabled: false,
    group: 'Combine',
    options: [],
    min: 1,
    max: 120,
    step: 1,
    seed: false,
    required: false,
    mediaOrder: 0,
  },
]

const graph: WorkflowGraph = {
  nodes: [
    { id: '16', title: '源视频', classType: 'VHS_LoadVideo', fieldIds: ['16::video'] },
    { id: '24', title: '合成输出', classType: 'VHS_VideoCombine', fieldIds: ['24::frame_rate'] },
  ],
  edges: [{ from: '16', to: '24' }],
}

const noop = () => {}

describe('工作流节点图', () => {
  it('画出全部节点，并按草稿字段写「N 参数 · 暴露 M」，尾节点标「输出」', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowGraphView, {
        graph,
        fields,
        selectedId: null,
        onSelect: noop,
        onPatch: noop,
      }),
    )
    expect(html).toContain('data-workflow-graph')
    expect(html).toContain('data-wf-node="16"')
    expect(html).toContain('data-wf-node="24"')
    expect(html).toContain('源视频')
    expect(html).toContain('1 参数 · 暴露 1')
    expect(html).toContain('1 参数 · 输出')
    /* 没选中节点时不该有弹层 */
    expect(html).not.toContain('data-workflow-graph-panel')
    /* 连线画成 path */
    expect(html).toContain('<path')
  })

  it('选中节点时弹层里就是那个节点的参数行', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowGraphView, {
        graph,
        fields,
        selectedId: '24',
        onSelect: noop,
        onPatch: noop,
      }),
    )
    expect(html).toContain('data-workflow-graph-panel="24"')
    expect(html).toContain('data-workflow-field="24::frame_rate"')
    /* 只列这个节点的字段，别把别的节点也倒进来 */
    expect(html).not.toContain('data-workflow-field="16::video"')
  })

  it('节点没有可改参数时给一句人话，而不是空弹层', () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowGraphView, {
        graph: { nodes: [{ id: '9', title: '纯连线', classType: 'X', fieldIds: [] }], edges: [] },
        fields,
        selectedId: '9',
        onSelect: noop,
        onPatch: noop,
      }),
    )
    expect(html).toContain('这个节点没有可改参数')
  })
})

describe('图上点击手势', () => {
  it('点节点 / 参数弹层 / 工具条都不算"点空白"（否则弹层会在勾选前被关掉）', () => {
    const target = (match: boolean) => ({ closest: () => (match ? {} : null) })
    expect(shouldStartGraphDrag(target(false))).toBe(true)
    expect(shouldStartGraphDrag(target(true))).toBe(false)
    /* 三块控件缺一不可：漏掉弹层 = 勾不上暴露（用户报的那个 bug） */
    expect(GRAPH_CONTROL_SELECTOR).toContain('[data-wf-node]')
    expect(GRAPH_CONTROL_SELECTOR).toContain('[data-workflow-graph-panel]')
    expect(GRAPH_CONTROL_SELECTOR).toContain('[data-graph-toolbar]')
  })
})
