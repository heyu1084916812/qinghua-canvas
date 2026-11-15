import { describe, expect, it } from 'vitest'
import { parseWorkflowsPageQuery, workflowsPagePath } from './workflowsPage'

describe('AI 应用 / 工作流页地址（#1131）', () => {
  it('往返：渠道 / 标签 / 条目', () => {
    const path = workflowsPagePath({ channelId: 'ch_builtin_runninghub_global', tab: 'workflow', entryId: '1904136902449209346' })
    expect(path).toBe('/workflows?channel=ch_builtin_runninghub_global&tab=workflow&entry=1904136902449209346')
    expect(parseWorkflowsPageQuery(path.split('?')[1]!)).toEqual({ channelId: 'ch_builtin_runninghub_global', tab: 'workflow', entryId: '1904136902449209346' })
  })
  it('缺省：AI 应用标签、不指定渠道', () => {
    expect(workflowsPagePath()).toBe('/workflows')
    expect(parseWorkflowsPageQuery('')).toEqual({ channelId: null, tab: 'app', entryId: null })
    expect(parseWorkflowsPageQuery('?tab=bogus&channel=%20').tab).toBe('app')
  })
})
