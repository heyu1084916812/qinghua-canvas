import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { workflowEntriesRowId } from '../../domain/project/workflowParams'
import { createWorkflowEntryStore } from './workflowEntryStore'

const entry = {
  id: 'w1',
  title: 'Z-Image 文生图',
  provider: 'runninghub' as const,
  fetchedAt: 1_700_000_000_000,
  fields: [],
}

describe('workflowEntryStore', () => {
  it('空库 = 没有条目（不抛）', async () => {
    const store = createWorkflowEntryStore(createMemoryPlatform().storage)
    await expect(store.load('ch-1')).resolves.toEqual([])
  })

  it('整份存取：写入后能原样读回', async () => {
    const platform = createMemoryPlatform()
    const store = createWorkflowEntryStore(platform.storage)
    await store.save('ch-1', [entry])
    await expect(store.load('ch-1')).resolves.toMatchObject([
      { id: 'w1', title: 'Z-Image 文生图', provider: 'runninghub' },
    ])
    /* 行 id 与 domain 约定一致（两边各写一份会漂移） */
    const rows = await platform.storage.query('presets', { id: workflowEntriesRowId('ch-1') })
    expect(rows).toHaveLength(1)
  })

  it('按渠道隔离：另一个渠道读不到', async () => {
    const platform = createMemoryPlatform()
    const store = createWorkflowEntryStore(platform.storage)
    await store.save('ch-1', [entry])
    await expect(store.load('ch-2')).resolves.toEqual([])
  })

  it('读回时走 normalizeWorkflowEntries：坏条目被丢掉，不把脏数据带进界面', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', {
      id: workflowEntriesRowId('ch-1'),
      entries: [entry, { id: '', title: '没有 id' }, 'nope'],
    } as never)
    const store = createWorkflowEntryStore(platform.storage)
    const loaded = await store.load('ch-1')
    expect(loaded.map((item) => item.id)).toEqual(['w1'])
  })
})
