import { describe, expect, it } from 'vitest'
import { latestUsageForItem, selectReferencesForTask, type ReferenceItem, type ReferenceUsage } from './referenceLedger'

const item = (id: string, projectId = 'p1'): ReferenceItem => ({
  id,
  projectId,
  title: id,
  source: 'asset',
  kind: 'image',
  what: `${id} 描述`,
  createdAt: 1,
  updatedAt: 1,
})

const usage = (
  id: string,
  itemId: string,
  taskKey: string,
  value: ReferenceUsage['usage'],
  projectId = 'p1',
): ReferenceUsage => ({
  id,
  itemId,
  projectId,
  taskKey,
  usage: value,
  howToUse: `${value} 用法`,
  createdAt: 1,
})

describe('project reference ledger rules', () => {
  it('selects only the current task usage and excludes other projects', () => {
    const result = selectReferencesForTask({
      projectId: 'p1',
      taskKey: 'kv',
      items: [item('logo'), item('mood'), item('other', 'p2')],
      usages: [
        usage('u1', 'logo', 'kv', 'identityAnchor'),
        usage('u2', 'mood', 'packaging', 'style'),
        usage('u3', 'other', 'kv', 'style', 'p2'),
      ],
    })
    expect(result.selected.map((x) => x.item.id)).toEqual(['logo'])
    expect(result.omitted.map((x) => x.reason)).toEqual(['no_usage'])
  })

  it('never sends avoid items and keeps identity anchors first', () => {
    const result = selectReferencesForTask({
      projectId: 'p1',
      taskKey: 'kv',
      items: [item('style'), item('avoid'), item('logo')],
      usages: [
        usage('u1', 'style', 'kv', 'style'),
        usage('u2', 'avoid', 'kv', 'avoid'),
        usage('u3', 'logo', 'kv', 'identityAnchor'),
      ],
    })
    expect(result.selected.map((x) => x.item.id)).toEqual(['logo', 'style'])
    expect(result.omitted).toEqual([{ item: item('avoid'), reason: 'avoid' }])
  })
})

describe('latestUsageForItem（同图多任务保留各自用法，卡片显示最新）', () => {
  const base = { projectId: 'p', usage: 'style' as const, howToUse: '' }
  it('按最近写入时间取，旧任务的用法仍保留在台账里', () => {
    const usages = [
      { ...base, id: 'a', itemId: 'i', taskKey: 'task:a', createdAt: 1, updatedAt: 50 },
      { ...base, id: 'b', itemId: 'i', taskKey: 'task:b', createdAt: 10 },
      { ...base, id: 'c', itemId: 'other', taskKey: 'task:b', createdAt: 99 },
    ]
    expect(latestUsageForItem(usages, 'i')?.id).toBe('a')
    expect(latestUsageForItem(usages.slice(1), 'i')?.id).toBe('b')
    expect(latestUsageForItem(usages, 'missing')).toBeUndefined()
  })
})
