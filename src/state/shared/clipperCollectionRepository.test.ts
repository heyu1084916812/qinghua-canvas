import { describe, expect, it } from 'vitest'
import { CLIPPER_COLLECTION_KEY } from '../../domain/inspiration/clipper'
import type { StoragePort } from '../../platform/ports'
import { createClipperCollectionRepository } from './clipperCollectionRepository'

function storageWith(rows: Record<string, unknown>[]) {
  return {
    async query(table: string, filter: Record<string, unknown>) {
      if (table !== 'presets') return []
      return rows.filter((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value),
      )
    },
    async put(table: string, row: Record<string, unknown>) {
      if (table !== 'presets') return
      const index = rows.findIndex((candidate) => candidate.id === row.id)
      if (index >= 0) rows[index] = row
      else rows.push(row)
    },
  } as unknown as StoragePort
}

describe('clipper collection repository', () => {
  it('loads, categorizes, moves and removes multiple account-level rows', async () => {
    const rows: Record<string, unknown>[] = []
    const repository = createClipperCollectionRepository(storageWith(rows))
    const item = {
      id: 'clip-1',
      source: 'web' as const,
      title: 'Reference',
      url: 'https://example.com/page',
      imageUrl: 'https://example.com/image.jpg',
      collectedAt: 10,
      category: '未分类',
    }
    const second = {
      ...item,
      id: 'clip-2',
      title: 'Second reference',
      imageUrl: 'https://example.com/second.jpg',
    }

    await repository.upsert([item, second])
    expect(await repository.load()).toEqual([item, second])
    expect(await repository.loadState()).toEqual({
      items: [item, second],
      categories: [],
    })
    expect(rows[0]).toMatchObject({ id: CLIPPER_COLLECTION_KEY })

    expect(await repository.createCategory('灵感')).toMatchObject({
      categories: ['灵感'],
    })
    expect(await repository.moveMany(['clip-1', 'clip-2'], '灵感')).toMatchObject({
      categories: ['灵感'],
      items: [
        expect.objectContaining({ id: 'clip-1', category: '灵感' }),
        expect.objectContaining({ id: 'clip-2', category: '灵感' }),
      ],
    })
    expect(await repository.removeMany(['clip-1', 'clip-2'])).toEqual({
      items: [],
      categories: ['灵感'],
    })
  })
})
