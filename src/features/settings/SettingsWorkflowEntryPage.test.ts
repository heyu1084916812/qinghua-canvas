import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { WorkflowEntry, WorkflowParamField } from '../../domain/project/workflowParams'
import { SettingsWorkflowEntryPage, fieldEditorKey } from './SettingsWorkflowEntryPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const channel = { id: 'ch-rh', name: 'RunningHub', icon: null, protocol: 'runninghub-api', baseUrl: '', models: [], credentialGroups: [] } as unknown as Channel
const field = (nodeId: string, fieldName: string): WorkflowParamField => ({
  id: `${nodeId}::${fieldName}`, nodeId, fieldName, type: 'text', label: fieldName, value: 'v', enabled: true,
  group: '', options: [], min: null, max: null, step: null, seed: false, required: false, mediaOrder: 0,
})
const entry = (id: string): WorkflowEntry => ({ id, kind: 'workflow', title: id, provider: 'runninghub', fields: [field('1', 'text')], fetchedAt: 1 })

describe('条目设置页 · 重新拉取后编辑器重挂（#1129 H2）', () => {
  it('fieldEditorKey 随 fetchedAt 变化', () => {
    expect(fieldEditorKey({ id: 'w', fetchedAt: 1 })).not.toBe(fieldEditorKey({ id: 'w', fetchedAt: 2 }))
  })

  it('★ 拉取到新字段表后点「保存参数」→ 存的是新字段表，不是旧 draft', () => {
    const onSaveFields = vi.fn()
    const props = (value: WorkflowEntry) => ({
      entry: value, busy: false, channel, channels: {} as ChannelStore, platform: createMemoryPlatform(),
      onBack: () => {}, onRefetch: () => {}, onPatch: () => {}, onSaveFields,
    })
    const before = entry('w1')
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(createElement(SettingsWorkflowEntryPage, props(before)))
    })
    const after = { ...before, fetchedAt: 2, fields: [field('1', 'text'), field('9', 'steps')] }
    act(() => renderer.update(createElement(SettingsWorkflowEntryPage, props(after))))
    const save = renderer.root.findAll((node) => node.type === 'button' && node.children.includes('保存参数'))[0]!
    act(() => save.props.onClick())
    expect(onSaveFields.mock.calls[0]![0].map((item: WorkflowParamField) => item.id)).toEqual(['1::text', '9::steps'])
  })
})
