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
  it('loads, upserts and removes account-level collection rows', async () => {
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

    await repository.upsert([item])
    expect(await repository.load()).toEqual([item])
    expect(rows[0]).toMatchObject({ id: CLIPPER_COLLECTION_KEY })

    await repository.remove('clip-1')
    expect(await repository.load()).toEqual([])
  })
})
