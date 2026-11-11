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
      assets: [
        { hash: 'logo-hash', role: 'logo', name: 'Logo' },
        { hash: 'photo-hash', role: 'reference', name: '照片' },
      ],
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
    expect(selection.selected[0]?.item.assets).toEqual([
      { hash: 'logo-hash', role: 'logo', name: 'Logo' },
      { hash: 'photo-hash', role: 'reference', name: '照片' },
    ])
    await repo.removeItem('p1', 'r1')
    expect(await repo.listItems('p1')).toEqual([])
    expect(await repo.listUsages('p1')).toEqual([])
  })
})

describe('reference ledger repository · G9 用户确认标记', () => {
  it('confirmedByUser 能存能读，旧行没有该字段', async () => {
    const repo = createReferenceLedgerRepository(createMemoryPlatform().storage)
    const base = { itemId: 'r1', projectId: 'p1', taskKey: 'task:t1', usage: 'subject' as const, howToUse: '借：杯形；避：白底', createdAt: 1 }
    await repo.putUsage({ ...base, id: 'u1', confirmedByUser: true })
    await repo.putUsage({ ...base, id: 'u2', itemId: 'r2' })
    const rows = await repo.listUsages('p1', 'task:t1')
    expect(rows.find((row) => row.id === 'u1')?.confirmedByUser).toBe(true)
    expect(rows.find((row) => row.id === 'u2')).not.toHaveProperty('confirmedByUser')
  })
})
