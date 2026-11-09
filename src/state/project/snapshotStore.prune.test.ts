import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createSnapshotStore } from './snapshotStore'

function seededPlatform(count = 12) {
  return createMemoryPlatform({
    rows: {
      snapshots: Array.from({ length: count }, (_, index) => ({
        id: `s${index}`,
        projectId: 'p1',
        createdAt: index,
        name: `snapshot-${index}`,
        nodeCount: 1,
        nodes: [{ id: 'n1' }],
        edges: [],
        runRecords: [],
      })),
    },
  })
}

beforeEach(() => {
  Date.now = () => 1_000
})

describe('snapshot retention', () => {
  it('prunes every project to the default seven newest snapshots', async () => {
    const platform = seededPlatform()
    const store = createSnapshotStore(platform.storage)
    const removed = await store.pruneAll(7)
    const kept = await store.list()
    expect(removed).toBe(5)
    expect(kept).toHaveLength(7)
    expect(kept[0]?.createdAt).toBe(11)
    expect(kept.at(-1)?.createdAt).toBe(5)
    expect(await platform.storage.query('snapshots', {})).toHaveLength(7)
  })

  it('prunes immediately after an automatic run and a manual capture', async () => {
    const platform = seededPlatform()
    await platform.storage.put('projects', {
      id: 'p1',
      name: '未命名项目',
      workbench: 'canvas',
      updatedAt: 1,
      createdAt: 1,
    } as never)
    await platform.storage.put('nodes', { id: 'n1', projectId: 'p1', type: 'generation' } as never)
    const store = createSnapshotStore(platform.storage)

    await store.runAuto({ now: 1_000 })
    expect(await platform.storage.query('snapshots', {})).toHaveLength(7)

    await store.capture('p1', 2_000)
    expect(await platform.storage.query('snapshots', {})).toHaveLength(7)
    expect((await store.list())[0]?.createdAt).toBe(2_000)
  })
})
