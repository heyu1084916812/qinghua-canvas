import { describe, expect, it, vi } from 'vitest'
import type { StorageAdminPort, StoragePort } from '../../platform/ports'
import {
  countStorageAssets,
  startStorageOverviewRefresh,
  type StorageOverviewArea,
  type StorageOverviewUpdate,
} from './storageOverviewRefresh'
import { countStorageProjects } from './storageOverviewProjectCount'

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
  it('uses one paged metadata count for live projects when available', async () => {
    const queryPage = vi.fn(async () => ({ rows: [{ id: 'p1' }], total: 334 }))
    const scan = vi.fn()
    const storage = { queryPage, scan } as unknown as StoragePort

    await expect(countStorageProjects(storage)).resolves.toBe(334)
    expect(queryPage).toHaveBeenCalledWith(
      'projects',
      {},
      {
        includePayload: false,
        fields: ['id'],
        missingFields: ['deletedAt'],
        offset: 0,
        limit: 1,
      },
    )
    expect(scan).not.toHaveBeenCalled()
  })

  it('falls back to a stream scan for older storage ports', async () => {
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
      other: 0,
      saved: 1,
    })
    expect(scan).toHaveBeenCalledWith(
      'assets',
      256,
      expect.any(Function),
      { includePayload: false },
    )
    expect(query).toHaveBeenCalledWith(
      'runRecords',
      {},
      {
        includePayload: false,
        fields: ['createdAt', 'outputHashes'],
      },
    )
    expect(query).toHaveBeenCalledWith(
      'assetLibrary',
      {},
      {
        includePayload: false,
        fields: ['id', 'hash', 'mime', 'savedAt', 'createdAt'],
      },
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
    expect(cacheReadStarted).toBe(true)

    usage.resolve({ used: 1024, quota: 0 })
    cache.resolve(4096)
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

    assets.resolve()
    await refresh.done
    expect(updates).toContain('assets')
    expect(updates).toContain('cache')
    expect(errors).toEqual([])
  })

  it('does not delay a paged project count behind desktop root or cache checks', async () => {
    const root = deferred<void>()
    const cache = deferred<number>()
    const updates: StorageOverviewUpdate['kind'][] = []
    let projectReadStarted = false
    const storage = {
      estimateUsage: async () => ({ used: 1, quota: 2 }),
      query: async () => [],
      queryPage: async () => {
        projectReadStarted = true
        return { rows: [{ id: 'p1' }], total: 334 }
      },
      scan: async () => 0,
    } as unknown as StoragePort
    const admin = {
      dataDir: async () => 'D:/data',
      inspectRoot: async () => {
        await root.promise
        return { path: 'D:/data', kind: 'v2', ready: true }
      },
      cacheUsage: () => cache.promise,
    } as unknown as StorageAdminPort

    void startStorageOverviewRefresh(
      { storage, admin },
      {
        onUpdate(update) {
          updates.push(update.kind)
        },
      },
    )

    await flush()
    expect(projectReadStarted).toBe(true)
    expect(updates).toContain('projects')
    expect(updates).not.toContain('root')
    expect(updates).not.toContain('cache')

    root.resolve()
    cache.resolve(2048)
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

  it('reuses in-flight project and asset counts across a StrictMode remount', async () => {
    const assetScan = deferred<void>()
    const projectScan = deferred<void>()
    const scanCalls = new Map<string, number>()
    const firstUpdates: StorageOverviewUpdate['kind'][] = []
    const secondUpdates: StorageOverviewUpdate['kind'][] = []
    const storage = {
      estimateUsage: async () => ({ used: 1, quota: 2 }),
      query: async () => [],
      scan: async (
        table: string,
        _batch: number,
        onBatch: (rows: never[], meta: { total: number }) => Promise<void>,
      ) => {
        scanCalls.set(table, (scanCalls.get(table) ?? 0) + 1)
        if (table === 'assets') {
          await assetScan.promise
          await onBatch([{ id: 'asset-1', mime: 'image/png' }] as never[], { total: 1 })
          return 1
        }
        await projectScan.promise
        await onBatch([{ id: 'project-1' }] as never[], { total: 1 })
        return 1
      },
    } as unknown as StoragePort

    const first = startStorageOverviewRefresh(
      { storage },
      {
        onUpdate(update) {
          firstUpdates.push(update.kind)
        },
      },
    )
    await flush()
    const second = startStorageOverviewRefresh(
      { storage },
      {
        onUpdate(update) {
          secondUpdates.push(update.kind)
        },
      },
    )
    await flush()

    expect(scanCalls.get('projects')).toBe(1)
    expect(scanCalls.get('assets')).toBe(1)

    first.cancel()
    const firstAfterCancel = [...firstUpdates]
    assetScan.resolve()
    projectScan.resolve()
    await second.done

    expect(firstUpdates).toEqual(firstAfterCancel)
    expect(secondUpdates).toEqual(
      expect.arrayContaining(['usage', 'projects', 'assets']),
    )
  })

  it('recounts after the shared in-flight read settles', async () => {
    let assetScans = 0
    const storage = {
      estimateUsage: async () => ({ used: 1, quota: 2 }),
      query: async () => [],
      scan: async (
        table: string,
        _batch: number,
        onBatch: (rows: never[], meta: { total: number }) => Promise<void>,
      ) => {
        if (table === 'assets') assetScans += 1
        await onBatch([], { total: 0 })
        return 0
      },
    } as unknown as StoragePort

    await startStorageOverviewRefresh({ storage }, { onUpdate() {} }).done
    await startStorageOverviewRefresh({ storage }, { onUpdate() {} }).done

    expect(assetScans).toBe(2)
  })
})
