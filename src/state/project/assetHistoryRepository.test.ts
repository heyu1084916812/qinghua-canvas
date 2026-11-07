import { describe, expect, it, vi } from 'vitest'
import { createAssetHistoryRepository } from './assetHistoryRepository'
import type { StoragePort } from '../../platform/ports'

describe('asset history repository', () => {
  it('scans large asset libraries in metadata-only batches of 128', async () => {
    const scan = vi.fn(async (_table, _batch, onBatch) => {
      await onBatch(
        [
          { id: 'image', hash: 'image', mime: 'image/png', bytesLength: 10 },
          { id: 'video', hash: 'video', mime: 'video/mp4', bytesLength: 20 },
        ] as never,
        { total: 1_400 },
      )
      return 1_400
    })
    const query = vi.fn(async (table: string) => {
      if (table === 'runRecords') {
        return [
          {
            id: 'run-1',
            nodeId: 'node-1',
            projectId: 'project-1',
            version: 1,
            createdAt: 1,
            status: 'succeeded',
            inputs: [],
            params: { prompt: 'fixture', model: 'image-model' },
            outputHashes: ['image', 'video'],
            fingerprint: 'fingerprint',
            taskId: 'task-1',
            durationMs: 1,
          },
        ]
      }
      if (table === 'assetLibrary') {
        return [{ id: 'saved', hash: 'saved', mime: 'image/png' }]
      }
      if (table === 'projects') return [{ id: 'project-1', name: '画布' }]
      return []
    })
    const storage = { scan, query } as unknown as StoragePort

    const history = await createAssetHistoryRepository(storage).list()

    expect(history.map((item) => item.kind === 'output' && item.hash)).toEqual([
      'image',
      'video',
    ])
    expect(scan).toHaveBeenCalledWith(
      'assets',
      128,
      expect.any(Function),
      { includePayload: false },
    )
  })

  it('falls back to the whole assets query when an old backend has no scan', async () => {
    const query = vi.fn(async (table: string) => {
      if (table === 'runRecords') {
        return [
          {
            id: 'run-1',
            nodeId: 'node-1',
            projectId: 'project-1',
            version: 1,
            createdAt: 1,
            status: 'succeeded',
            inputs: [],
            params: { prompt: 'fixture', model: 'image-model' },
            outputHashes: ['image'],
            fingerprint: 'fingerprint',
            taskId: 'task-1',
            durationMs: 1,
          },
        ]
      }
      if (table === 'assets') {
        return [{ id: 'image', hash: 'image', mime: 'image/png', bytes: new Uint8Array(10) }]
      }
      return []
    })
    const storage = { query } as unknown as StoragePort

    const history = await createAssetHistoryRepository(storage).list()

    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ kind: 'output', hash: 'image', bytes: 10 })
    expect(query).toHaveBeenCalledWith('assets', {})
  })
})
