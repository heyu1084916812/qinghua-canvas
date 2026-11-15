import { describe, expect, it } from 'vitest'
import { parseWorkflowEntryRef } from './workflowEntryRef'

describe('导入输入 → 条目（#1128 L4）', () => {
  it('应用详情页 /ai-detail/<id> 认成应用（国内站 / 国际站）', () => {
    expect(parseWorkflowEntryRef('https://www.runninghub.cn/ai-detail/1877265245566922753')).toEqual({ id: '1877265245566922753', kind: 'app' })
    expect(parseWorkflowEntryRef('https://www.runninghub.ai/ai-detail/1877265245566922753?x=1')).toEqual({ id: '1877265245566922753', kind: 'app' })
  })
  it('/run/ai-app、/run/workflow、workflowId= 照旧', () => {
    expect(parseWorkflowEntryRef('https://www.runninghub.cn/run/ai-app/1877265245566922753')?.kind).toBe('app')
    expect(parseWorkflowEntryRef('/run/workflow/1997246493079834625')).toEqual({ id: '1997246493079834625', kind: 'workflow' })
    expect(parseWorkflowEntryRef('https://x/?workflowId=1997246493079834625')?.kind).toBe('workflow')
  })
  it('纯数字 id 种类不定（调用方先按工作流、再按应用试），认不出的回 null', () => {
    expect(parseWorkflowEntryRef(' 1997246493079834625 ')).toEqual({ id: '1997246493079834625', kind: null })
    expect(parseWorkflowEntryRef('abc')).toBeNull()
    expect(parseWorkflowEntryRef('')).toBeNull()
  })
})
