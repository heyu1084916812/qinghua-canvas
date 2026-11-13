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
    expect(query).toHaveBeenCalledWith(
      'runRecords',
      {},
      expect.objectContaining({
        includePayload: false,
        fields: expect.arrayContaining([
          'createdAt',
          'outputHashes',
          'outputWidth',
          'outputHeight',
          'params',
        ]),
      }),
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

  it('loads only one ordered run page and resolves asset metadata by the page hashes', async () => {
    const queryPage = vi.fn(async (table: string) => {
      if (table === 'runRecords') {
        return {
          rows: [
            {
              id: 'run-page-1',
              projectId: 'project-1',
              createdAt: 20,
              outputHashes: ['image-page-1'],
              params: { prompt: 'first page' },
            },
          ],
          total: 600,
        }
      }
      if (table === 'assets') {
        return {
          rows: [
            {
              id: 'image-page-1',
              hash: 'image-page-1',
              mime: 'image/png',
              width: 320,
              height: 320,
              bytesLength: 12,
            },
          ],
          total: 1,
        }
      }
      return { rows: [], total: 0 }
    })
    const query = vi.fn(async (table: string) => {
      if (table === 'assetLibrary') return []
      if (table === 'projects') return [{ id: 'project-1', name: '画布' }]
      return []
    })
    const storage = { query, queryPage } as unknown as StoragePort

    const page = await createAssetHistoryRepository(storage).listPage()

    expect(queryPage).toHaveBeenCalledWith(
      'runRecords',
      {},
      expect.objectContaining({
        includePayload: false,
        orderBy: { field: 'createdAt', direction: 'desc' },
        offset: 0,
        limit: 30,
      }),
    )
    expect(queryPage).toHaveBeenCalledWith(
      'assets',
      {},
      expect.objectContaining({
        ids: ['image-page-1'],
        includePayload: false,
      }),
    )
    expect(query).not.toHaveBeenCalledWith('assets', expect.anything())
    expect(page).toMatchObject({
      nextOffset: 1,
      hasMore: true,
      totalRuns: 600,
    })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({ kind: 'output', bytes: 12 })
  })

  it('skips a first page made only of runs without outputs instead of showing an empty list', async () => {
    /* 用户 2026-11-13 报：一开始右侧空白，点「加载更多」才出现 —— 因为最新 30 条
       run 都没有产物，而分页按 run 行数算。这里钉住：第一次 listPage 就要拿到图。 */
    const runs = [
      ...Array.from({ length: 30 }, (_, index) => ({
        id: `failed-${index}`,
        projectId: 'project-1',
        createdAt: 100 - index,
        params: { prompt: '没有产物' },
      })),
      {
        id: 'run-with-output',
        projectId: 'project-1',
        createdAt: 50,
        outputHashes: ['image-late'],
        params: { prompt: '这条有图' },
      },
    ]
    const queryPage = vi.fn(async (table: string, _query, options: { offset?: number; limit?: number }) => {
      if (table === 'runRecords') {
        const offset = options.offset ?? 0
        const limit = options.limit ?? 30
        return { rows: runs.slice(offset, offset + limit), total: runs.length }
      }
      if (table === 'assets') {
        return {
          rows: [
            {
              id: 'image-late',
              hash: 'image-late',
              mime: 'image/png',
              width: 64,
              height: 64,
              bytesLength: 8,
            },
          ],
          total: 1,
        }
      }
      return { rows: [], total: 0 }
    })
    const query = vi.fn(async (table: string) => {
      if (table === 'projects') return [{ id: 'project-1', name: '画布' }]
      return []
    })
    const storage = { query, queryPage } as unknown as StoragePort

    const page = await createAssetHistoryRepository(storage).listPage()

    expect(page.items.map((item) => item.kind === 'output' && item.hash)).toEqual(['image-late'])
    expect(page).toMatchObject({ nextOffset: 31, hasMore: false, totalRuns: 31 })
    /* 第一页仍然按调用方给的 30 行取，之后才用更大的批次补页 */
    expect(queryPage).toHaveBeenNthCalledWith(
      1,
      'runRecords',
      {},
      expect.objectContaining({ offset: 0, limit: 30 }),
    )
  })

  it('returns an empty page without looping when every run lacks outputs', async () => {
    const runs = Array.from({ length: 5 }, (_, index) => ({
      id: `failed-${index}`,
      projectId: 'project-1',
      createdAt: 10 - index,
      params: { prompt: '失败' },
    }))
    const calls: number[] = []
    const queryPage = vi.fn(async (table: string, _query, options: { offset?: number; limit?: number }) => {
      if (table === 'runRecords') {
        const offset = options.offset ?? 0
        calls.push(offset)
        return { rows: runs.slice(offset, offset + (options.limit ?? 30)), total: runs.length }
      }
      return { rows: [], total: 0 }
    })
    const query = vi.fn(async () => [])
    const storage = { query, queryPage } as unknown as StoragePort

    const page = await createAssetHistoryRepository(storage).listPage()

    expect(page.items).toHaveLength(0)
    expect(page).toMatchObject({ nextOffset: 5, hasMore: false, totalRuns: 5 })
    expect(calls).toEqual([0])
  })
})
