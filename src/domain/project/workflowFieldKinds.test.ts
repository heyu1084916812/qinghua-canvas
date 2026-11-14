import { describe, expect, it } from 'vitest'
import type { WorkflowParamField } from './workflowParams'
import {
  knownOptionsForField,
  withKnownOptions,
  workflowFieldTypeLabel,
} from './workflowFieldKinds'

function field(patch: Partial<WorkflowParamField> = {}): WorkflowParamField {
  return {
    id: '6::seed',
    nodeId: '6',
    fieldName: 'seed',
    type: 'text',
    label: 'seed',
    value: '42',
    enabled: false,
    group: '',
    options: [],
    min: null,
    max: null,
    step: null,
    seed: true,
    required: false,
    mediaOrder: 0,
    ...patch,
  }
}

describe('工作流字段的候选值与类型标签（复刻 canvas-xiong 的 RH_EDITOR_KNOWN_FIELD_OPTIONS）', () => {
  it('按字段名给候选，大小写不敏感；没登记的返回空数组（不糊弄）', () => {
    expect(knownOptionsForField('sampler_name')).toContain('euler')
    expect(knownOptionsForField('aspectRatio')).toContain('16:9')
    expect(knownOptionsForField('AspEctRatio')).toEqual(knownOptionsForField('aspectRatio'))
    expect(knownOptionsForField('some_unknown_field')).toEqual([])
    expect(knownOptionsForField('')).toEqual([])
  })

  it('withKnownOptions：只补空候选；补完文本 → 下拉，数字仍是数字', () => {
    const [, ratio, unknown, keep] = withKnownOptions([
      field({ fieldName: 'sampler_name' }),
      field({ fieldName: 'ratio' }),
      field({ fieldName: 'no_such_field' }),
      field({ fieldName: 'ratio', options: ['自定义'] }),
    ])
    expect(ratio?.type).toBe('select')
    expect(ratio?.options).toContain('16:9')
    expect(unknown?.type).toBe('text')
    expect(unknown?.options).toEqual([])
    /* 已有候选不许被字典覆盖 */
    expect(keep?.options).toEqual(['自定义'])
  })

  it('数字类字段补候选后仍是 number（由范围控件呈现，而不是下拉）', () => {
    const [steps] = withKnownOptions([field({ fieldName: 'steps', type: 'number', value: '20' })])
    expect(steps?.type).toBe('number')
    expect(steps?.options.length).toBeGreaterThan(0)
  })

  it('类型标签可读', () => {
    expect(workflowFieldTypeLabel('select')).toBe('下拉')
    expect(workflowFieldTypeLabel('image')).toBe('图片')
  })
})
