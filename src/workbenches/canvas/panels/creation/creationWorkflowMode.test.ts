import { describe, expect, it } from 'vitest'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { WorkflowEntry, WorkflowParamField } from '../../../../domain/project/workflowParams'
import { modeOfModel, workflowSubmitList, workflowValueMap } from './creationWorkflowMode'

function field(patch: Partial<WorkflowParamField>): WorkflowParamField {
  return {
    id: '6::text',
    nodeId: '6',
    fieldName: 'text',
    type: 'text',
    label: '提示词',
    value: '默认',
    enabled: false,
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

const entry: WorkflowEntry = {
  id: 'w1',
  title: '测试工作流',
  provider: 'runninghub',
  fetchedAt: 0,
  fields: [
    field({ id: '6::text', fieldName: 'text', enabled: true, value: '默认' }),
    field({ id: '7::seed', nodeId: '7', fieldName: 'seed', enabled: false, value: '42' }),
    field({ id: '8::ratio', nodeId: '8', fieldName: 'ratio', enabled: true, value: '' }),
  ],
}

describe('创作面板的来源模式（API / AI 应用 / 工作流）', () => {
  it('模式由模型 id 反推，不新增节点字段', () => {
    expect(modeOfModel('workflow:2039')).toBe('flow')
    expect(modeOfModel('app:1877')).toBe('app')
    expect(modeOfModel('GPT Image 2')).toBe('api')
    expect(modeOfModel('')).toBe('api')
  })

  it('节点上的提交体 → 字段 id 到值的映射', () => {
    const data = {
      workflowNodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: '改过的' }],
    } as unknown as GenerationData
    expect(workflowValueMap(data)).toEqual({ '6::text': '改过的' })
    expect(workflowValueMap({} as GenerationData)).toEqual({})
  })

  it('★ 只发暴露字段；值没填回落默认；空串照发（= 清空参数）', () => {
    expect(workflowSubmitList(entry, {})).toEqual([
      { nodeId: '6', fieldName: 'text', fieldValue: '默认' },
      { nodeId: '8', fieldName: 'ratio', fieldValue: '' },
    ])
    expect(workflowSubmitList(entry, { '6::text': '新值' })[0]?.fieldValue).toBe('新值')
  })
})
