import { describe, expect, it } from 'vitest'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { WorkflowEntry, WorkflowParamField } from '../../../../domain/project/workflowParams'
import { UPSTREAM_MEDIA_VALUE } from '../../../../domain/project/workflowParamValues'
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
    field({ id: '6::text', enabled: true, value: '默认' }),
    field({ id: '7::seed', nodeId: '7', fieldName: 'seed', enabled: false, value: '42' }),
    field({ id: '16::video', nodeId: '16', fieldName: 'video', type: 'video', enabled: true, value: '' }),
    field({ id: '20::ratio', nodeId: '20', fieldName: 'ratio', enabled: true, value: '' }),
  ],
}

describe('创作面板的来源模式（API / AI 应用 / 工作流）', () => {
  it('模式由模型 id 反推，不新增节点字段', () => {
    expect(modeOfModel('workflow:2039')).toBe('flow')
    expect(modeOfModel('app:1877')).toBe('app')
    expect(modeOfModel('GPT Image 2')).toBe('api')
  })

  it('节点上的提交体 → 字段 id 到值的映射', () => {
    const data = {
      workflowNodeInfoList: [{ nodeId: '6', fieldName: 'text', fieldValue: '改过的' }],
    } as unknown as GenerationData
    expect(workflowValueMap(data)).toEqual({ '6::text': '改过的' })
  })

  it('★ 只发暴露字段；媒体发「用上游」哨兵；文本空串照发', () => {
    expect(workflowSubmitList(entry, {})).toEqual([
      { nodeId: '6', fieldName: 'text', fieldValue: '默认' },
      { nodeId: '16', fieldName: 'video', fieldValue: UPSTREAM_MEDIA_VALUE },
      { nodeId: '20', fieldName: 'ratio', fieldValue: '' },
    ])
  })

  it('面板填过的值优先（媒体填了文件名就不再发哨兵）', () => {
    expect(
      workflowSubmitList(entry, { '6::text': '新值', '16::video': 'uploaded-1.mp4' }),
    ).toEqual([
      { nodeId: '6', fieldName: 'text', fieldValue: '新值' },
      { nodeId: '16', fieldName: 'video', fieldValue: 'uploaded-1.mp4' },
      { nodeId: '20', fieldName: 'ratio', fieldValue: '' },
    ])
  })
})
