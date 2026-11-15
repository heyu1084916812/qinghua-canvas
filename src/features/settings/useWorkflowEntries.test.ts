import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { Channel } from '../../domain/project/channel'
import type { ChannelStore } from '../../state/channel/channelStore'
import { workflowEntriesRowId, type WorkflowEntry, type WorkflowParamField } from '../../domain/project/workflowParams'
import { createWorkflowEntryStore } from '../../state/channel/workflowEntryStore'
import { useWorkflowEntries, type WorkflowEntriesState } from './useWorkflowEntries'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const channel = {
  id: 'ch-rh',
  name: 'RunningHub',
  icon: null,
  protocol: 'runninghub-api',
  baseUrl: 'https://www.runninghub.cn',
  models: [],
  credentialGroups: [],
} as unknown as Channel

const field = (nodeId: string, fieldName: string): WorkflowParamField => ({
  id: `${nodeId}::${fieldName}`, nodeId, fieldName, type: 'text', label: fieldName, value: 'v', enabled: true,
  group: '', options: [], min: null, max: null, step: null, seed: false, required: false, mediaOrder: 0,
})
const entry = (id: string, title = id): WorkflowEntry => ({ id, kind: 'workflow', title, provider: 'runninghub', fields: [field('1', 'text')], fetchedAt: 1 })

function mount(platform = createMemoryPlatform(), channels = {} as ChannelStore) {
  const ref: { current: WorkflowEntriesState | null } = { current: null }
  function Probe() {
    ref.current = useWorkflowEntries({ channel, channels, platform })
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe))
  })
  return { ref, renderer, platform }
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

describe('useWorkflowEntries（#1129 M7）', () => {
  it('★ 首次读取完成前 ready=false；读失败保持 false 并说明「导入已暂停」', async () => {
    const platform = createMemoryPlatform()
    platform.storage.query = (() => Promise.reject(new Error('idb broken'))) as typeof platform.storage.query
    const { ref } = mount(platform)
    expect(ref.current!.ready).toBe(false)
    await flush()
    expect(ref.current!.ready).toBe(false)
    expect(ref.current!.error).toMatch(/导入已暂停/)
  })

  it('★ 改名 / 删除基于库里最新数据：别处在途写入的条目不被界面闭包覆盖掉', async () => {
    const platform = createMemoryPlatform()
    const store = createWorkflowEntryStore(platform.storage)
    await store.save(channel.id, [entry('w1'), entry('w2')])
    const channels = { setModels: vi.fn(async () => {}) } as unknown as ChannelStore
    const { ref } = mount(platform, channels)
    await flush()
    expect(ref.current!.ready).toBe(true)
    /* 界面加载后，库里又多了一条（例如另一处导入完成） */
    await store.update(channel.id, (list) => [...list, entry('w3')])
    await act(async () => {
      await ref.current!.patchEntry(ref.current!.entries[0]!, { title: '改过的名' })
      await ref.current!.removeEntry(ref.current!.entries[1]!)
    })
    const saved = await store.load(channel.id)
    expect(saved.map((item) => [item.id, item.title])).toEqual([['w1', '改过的名'], ['w3', 'w3']])
  })

  it('★ 保存参数写失败 → 报错、不提示「已保存」', async () => {
    const platform = createMemoryPlatform()
    await createWorkflowEntryStore(platform.storage).save(channel.id, [entry('w1')])
    const channels = { setModels: vi.fn(async () => {}) } as unknown as ChannelStore
    const { ref } = mount(platform, channels)
    await flush()
    platform.storage.put = (() => Promise.reject(new Error('quota'))) as typeof platform.storage.put
    await act(async () => {
      await ref.current!.saveFields(ref.current!.entries[0]!, [])
    })
    expect(ref.current!.error).toContain('quota')
    expect(ref.current!.notice).toBe('')
    expect(await platform.storage.query('presets', { id: workflowEntriesRowId(channel.id) })).toHaveLength(1)
  })
})
