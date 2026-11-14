import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkflowEntry } from '../../domain/project/workflowParams'
import { SourceRowDemo } from './SourceRowDemo'

const entry: WorkflowEntry = {
  id: 'w1',
  title: '视频超分与补帧',
  provider: 'runninghub',
  fetchedAt: 0,
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
  ],
}

describe('来源行示例', () => {
  it('默认工作流模式：显示渠道 / 模式 / 条目 / 实例 / 暴露参数', () => {
    const html = renderToStaticMarkup(
      createElement(SourceRowDemo, { channelId: 'ch-1', entries: [entry] }),
    )
    expect(html).toContain('data-demo-source')
    expect(html).toContain('RunningHub')
    expect(html).toContain('工作流')
    expect(html).toContain('24G')
    expect(html).toContain('源视频')
  })
})
