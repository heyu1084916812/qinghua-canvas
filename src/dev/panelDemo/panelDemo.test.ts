import { describe, expect, it } from 'vitest'
import type { WorkflowParamField } from '../../domain/project/workflowParams'
import { workflowSummaryLabel } from '../../workbenches/canvas/panels/creation/WorkflowParameterControls'
import demoHtml from '../../../dev/panel-demo.html?raw'

/**
 * 示例页的证据：**入口真的指向产品组件**，参数摘要那句话真的按当前值拼。
 *
 * 示例页自身是 `main.tsx` 那段挂载脚本（浏览器专属），单测不跑它；
 * 但「面板参数行上写什么」这件事是纯函数，必须钉住 —— 上一版这里写的是
 * 「参数 2」这种计数，用户看不出这次会发什么值。
 */

function field(patch: Partial<WorkflowParamField> & Pick<WorkflowParamField, 'id' | 'fieldName'>): WorkflowParamField {
  return {
    nodeId: '1',
    type: 'text',
    label: '',
    value: '',
    enabled: true,
    group: '',
    options: [],
    min: null,
    max: null,
    step: null,
    seed: false,
    required: false,
    mediaOrder: 0,
    ...patch,
  }
}

describe('创作面板示例页', () => {
  it('页面入口指向真实面板的挂载脚本', () => {
    expect(demoHtml).toContain('/src/dev/panelDemo/main.tsx')
  })
})

describe('工作流参数摘要', () => {
  it('媒体字段写名字、其余写当前值（与 API 模式「4K · 高 · 16:9」同一句话的意思）', () => {
    const fields = [
      field({ id: '16::video', nodeId: '16', fieldName: 'video', type: 'video', label: '源视频' }),
      field({ id: '65::strength', nodeId: '65', fieldName: 'strength', type: 'number', value: '0.8' }),
      field({ id: '20::ratio', nodeId: '20', fieldName: 'ratio', type: 'select', value: '16:9' }),
    ]
    expect(workflowSummaryLabel(fields, {})).toBe('源视频 · 0.8 · 16:9')
    expect(workflowSummaryLabel(fields, { '65::strength': '0.4' })).toBe('源视频 · 0.4 · 16:9')
  })

  it('未暴露的字段不进摘要；超过四段就截断', () => {
    const fields = [
      field({ id: '1::a', fieldName: 'a', value: 'A' }),
      field({ id: '2::b', fieldName: 'b', value: 'B' }),
      field({ id: '3::c', fieldName: 'c', value: 'C', enabled: false }),
      field({ id: '4::d', fieldName: 'd', value: 'D' }),
      field({ id: '5::e', fieldName: 'e', value: 'E' }),
      field({ id: '6::f', fieldName: 'f', value: 'F' }),
    ]
    expect(workflowSummaryLabel(fields, {})).toBe('A · B · D · E')
  })

  it('布尔写成开 / 关，空值跳过', () => {
    const fields = [
      field({ id: '1::on', fieldName: 'on', type: 'boolean', value: 'true' }),
      field({ id: '2::empty', fieldName: 'empty', value: '' }),
      field({ id: '3::off', fieldName: 'off', type: 'boolean', value: 'false' }),
    ]
    expect(workflowSummaryLabel(fields, {})).toBe('开 · 关')
  })
})
