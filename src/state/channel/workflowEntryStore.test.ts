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

describe('#1129 M7 / M12 / M8', () => {
  const e2 = { ...entry, id: 'w2', title: '第二条' }
  it('★ M12：读失败抛错（不是回 []），update 读失败时不写', async () => {
    const platform = createMemoryPlatform()
    const store = createWorkflowEntryStore(platform.storage)
    await store.save('ch-1', [entry])
    const realQuery = platform.storage.query.bind(platform.storage)
    let puts = 0
    const realPut = platform.storage.put.bind(platform.storage)
    platform.storage.query = (() => Promise.reject(new Error('idb broken'))) as typeof platform.storage.query
    platform.storage.put = ((t: never, r: never) => { puts += 1; return realPut(t, r) }) as typeof platform.storage.put
    await expect(store.load('ch-1')).rejects.toThrow(/读不到/)
    await expect(store.update('ch-1', () => [])).rejects.toThrow(/读不到/)
    expect(puts).toBe(0)
    platform.storage.query = realQuery
    await expect(store.load('ch-1')).resolves.toHaveLength(1)
  })

  it('★ M12：写失败抛错（界面据此报错，不再提示「已保存」）', async () => {
    const platform = createMemoryPlatform()
    platform.storage.put = (() => Promise.reject(new Error('quota'))) as typeof platform.storage.put
    await expect(createWorkflowEntryStore(platform.storage).save('ch-1', [entry])).rejects.toThrow('quota')
  })

  it('★ M7：两次并发 update 都基于最新数据（导入期间删掉的条目不会复活）', async () => {
    const store = createWorkflowEntryStore(createMemoryPlatform().storage)
    await store.save('ch-1', [entry])
    await Promise.all([
      store.update('ch-1', (list) => [...list, e2]),
      store.update('ch-1', (list) => list.filter((item) => item.id !== 'w1')),
    ])
    expect((await store.load('ch-1')).map((item) => item.id)).toEqual(['w2'])
  })

  it('★ M8：removeAll 清掉这条渠道的条目行', async () => {
    const platform = createMemoryPlatform()
    const store = createWorkflowEntryStore(platform.storage)
    await store.save('ch-1', [entry])
    await store.removeAll('ch-1')
    expect(await platform.storage.query('presets', { id: workflowEntriesRowId('ch-1') })).toHaveLength(0)
  })
})
