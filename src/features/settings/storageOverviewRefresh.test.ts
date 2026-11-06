import { describe, expect, it, vi } from 'vitest'
import type { StorageAdminPort, StoragePort } from '../../platform/ports'
import {
  countStorageAssets,
  countStorageProjects,
  startStorageOverviewRefresh,
  type StorageOverviewArea,
  type StorageOverviewUpdate,
} from './storageOverviewRefresh'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

async function flush() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

describe('storage overview refresh', () => {
  it('counts only live projects without loading project payloads', async () => {
    const scan = vi.fn(async (_table, _batch, onBatch) => {
      await onBatch([{ id: 'p1' }, { id: 'p2', deletedAt: 1 }] as never, { total: 2 })
      return 2
    })
    const storage = { scan } as unknown as StoragePort

    await expect(countStorageProjects(storage)).resolves.toBe(1)
    expect(scan).toHaveBeenCalledWith(
      'projects',
      50,
      expect.any(Function),
      { includePayload: false },
    )
  })

  it('uses the same deduplicated asset count as the assets page', async () => {
    const now = Date.now()
    const scan = vi.fn(async (_table, _batch, onBatch) => {
      await onBatch(
        [
          { id: 'image', hash: 'image', mime: 'image/png', bytesLength: 10 },
          { id: 'video', hash: 'video', mime: 'video/mp4', bytesLength: 20 },
          { id: 'hidden', hash: 'hidden', mime: 'image/png', bytesLength: 30 },
        ] as never,
        { total: 3 },
      )
      return 3
    })
    const query = vi.fn(async (table: string) => {
      if (table === 'runRecords') {
        return [
          {
            id: 'run-1',
            nodeId: 'node-1',
            projectId: 'project-1',
            version: 1,
            createdAt: now,
            status: 'succeeded',
            inputs: [],
            params: { prompt: 'fixture', model: 'image-model' },
            outputHashes: ['image', 'video', 'hidden'],
            fingerprint: 'fingerprint',
            taskId: 'task-1',
            durationMs: 1,
          },
        ]
      }
      if (table === 'assetLibrary') {
        return [{ id: 'uploaded', hash: 'uploaded', mime: 'image/webp', savedAt: now }]
      }
      if (table === 'presets') {
        return [{ id: 'assetRecordsHidden:v1', hashes: ['hidden'] }]
      }
      return []
    })
    const storage = { scan, query } as unknown as StoragePort

    await expect(countStorageAssets(storage, now)).resolves.toMatchObject({
      all: 3,
      image: 2,
      video: 1,
      audio: 0,
      saved: 1,
    })
    expect(scan).toHaveBeenCalledWith(
      'assets',
      8,
      expect.any(Function),
      { includePayload: false },
    )
  })

  it('publishes quick information before slow asset statistics finish', async () => {
    const usage = deferred<{ used: number; quota: number }>()
    const projects = deferred<void>()
    const assets = deferred<void>()
    const root = deferred<void>()
    const cache = deferred<number>()
    const updates: StorageOverviewUpdate['kind'][] = []
    const errors: StorageOverviewArea[] = []
    let assetScanStarted = false
    let cacheReadStarted = false

    const storage = {
      estimateUsage: () => usage.promise,
      query: async () => [],
      scan: async (table: string, _batch: number, onBatch: (rows: never[], meta: { total: number }) => Promise<void>) => {
        if (table === 'projects') {
          await projects.promise
          await onBatch([{ id: 'p1' }] as never[], { total: 1 })
          return 1
        }
        assetScanStarted = true
        await assets.promise
        await onBatch([{ id: 'asset-1', mime: 'image/png' }] as never[], { total: 1 })
        return 1
      },
    } as unknown as StoragePort
    const admin = {
      dataDir: async () => 'D:/data',
      inspectRoot: async () => {
        await root.promise
        return { path: 'D:/data', kind: 'v2', ready: true }
      },
      cacheUsage: () => {
        cacheReadStarted = true
        return cache.promise
      },
    } as unknown as StorageAdminPort

    const refresh = startStorageOverviewRefresh(
      { storage, admin },
      {
        onUpdate(update) {
          updates.push(update.kind)
        },
        onError(area) {
          errors.push(area)
        },
      },
    )

    await flush()
    expect(updates).toEqual(['data-dir'])
    expect(assetScanStarted).toBe(false)
    expect(cacheReadStarted).toBe(false)

    usage.resolve({ used: 1024, quota: 0 })
    await flush()
    expect(updates).toContain('usage')
    expect(updates).not.toContain('projects')
    expect(updates).not.toContain('assets')
    expect(updates).toContain('cache')
    expect(assetScanStarted).toBe(false)
    expect(cacheReadStarted).toBe(true)

    projects.resolve()
    root.resolve()
    await flush()
    expect(updates).toEqual(expect.arrayContaining(['data-dir', 'usage', 'root']))
    expect(updates).not.toContain('assets')
    await flush()
    expect(updates).toContain('projects')
    expect(assetScanStarted).toBe(true)

    cache.resolve(4096)
    assets.resolve()
    await refresh.done
    expect(updates).toContain('assets')
    expect(updates).toContain('cache')
    expect(errors).toEqual([])
  })

  it('isolates one failed read and still publishes the rest', async () => {
    const updates: StorageOverviewUpdate['kind'][] = []
    const errors: StorageOverviewArea[] = []
    const storage = {
      estimateUsage: async () => {
        throw new Error('usage failed')
      },
      query: async () => [],
      scan: async (
        table: string,
        _batch: number,
        onBatch: (rows: never[], meta: { total: number }) => Promise<void>,
      ) => {
        await onBatch(
          (table === 'projects' ? [{ id: 'p1' }] : [{ id: 'asset-1', mime: 'image/png' }]) as never[],
          { total: 1 },
        )
        return 1
      },
    } as unknown as StoragePort
    const admin = {
      dataDir: async () => 'D:/data',
      inspectRoot: async () => ({ path: 'D:/data', kind: 'v2', ready: true }),
      cacheUsage: async () => 2048,
    } as unknown as StorageAdminPort

    const refresh = startStorageOverviewRefresh(
      { storage, admin },
      {
        onUpdate(update) {
          updates.push(update.kind)
        },
        onError(area) {
          errors.push(area)
        },
      },
    )
    await refresh.done

    expect(errors).toEqual(['usage'])
    expect(updates).toEqual(
      expect.arrayContaining(['data-dir', 'root', 'projects', 'assets', 'cache']),
    )
  })

  it('does not publish late results after the panel cancels the refresh', async () => {
    const usage = deferred<{ used: number; quota: number }>()
    const updates: StorageOverviewUpdate['kind'][] = []
    const scannedTables: string[] = []
    const storage = {
      estimateUsage: () => usage.promise,
      query: async () => [],
      scan: async (
        _table: string,
        _batch: number,
        onBatch: (rows: never[], meta: { total: number }) => Promise<void>,
      ) => {
        scannedTables.push(_table)
        await onBatch([], { total: 0 })
        return 0
      },
    } as unknown as StoragePort

    const refresh = startStorageOverviewRefresh(
      { storage },
      {
        onUpdate(update) {
          updates.push(update.kind)
        },
      },
    )
    refresh.cancel()
    usage.resolve({ used: 1, quota: 1 })
    await refresh.done
    expect(updates).toEqual([])
    expect(scannedTables).not.toContain('assets')
  })
})
