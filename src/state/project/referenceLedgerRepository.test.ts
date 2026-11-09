import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createReferenceLedgerRepository } from './referenceLedgerRepository'

describe('reference ledger repository', () => {
  it('isolates items by project and deletes usages with their item', async () => {
    const platform = createMemoryPlatform()
    const repo = createReferenceLedgerRepository(platform.storage)
    await repo.putItem({
      id: 'r1',
      projectId: 'p1',
      title: 'Logo',
      source: 'kit',
      kind: 'image',
      kitId: 'k1',
      kitVersion: 2,
      what: '绿色圆角标准字',
      createdAt: 1,
      updatedAt: 1,
    })
    await repo.putItem({
      id: 'r2',
      projectId: 'p2',
      title: 'Other',
      source: 'asset',
      kind: 'image',
      what: '别的项目',
      createdAt: 2,
      updatedAt: 2,
    })
    await repo.putUsage({
      id: 'u1',
      itemId: 'r1',
      projectId: 'p1',
      taskKey: 'kv',
      usage: 'identityAnchor',
      howToUse: '保持字形与颜色',
      identityAnchor: true,
      createdAt: 2,
    })
    expect((await repo.listItems('p1')).map((row) => row.id)).toEqual(['r1'])
    const selection = await repo.selectForTask('p1', 'kv')
    expect(selection.selected).toHaveLength(1)
    expect(selection.selected[0]?.item.kitVersion).toBe(2)
    await repo.removeItem('p1', 'r1')
    expect(await repo.listItems('p1')).toEqual([])
    expect(await repo.listUsages('p1')).toEqual([])
  })
})
