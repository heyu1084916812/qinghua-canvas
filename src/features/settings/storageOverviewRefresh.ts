import type {
  StorageAdminPort,
  StoragePort,
  StorageRootInfo,
} from '../../platform/ports'
import {
  countAssets,
  type LibraryCountRow,
} from '../../domain/shared/assetHistory'
import { createAssetHistoryRepository } from '../../state/project/assetHistoryRepository'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'
import { readStorageCount } from './storageOverviewReadDedup'

export interface StorageUsage {
  used: number
  quota: number
}

export type StorageAssetCounts = ReturnType<typeof countAssets>

export type StorageOverviewUpdate =
  | { kind: 'usage'; usage: StorageUsage }
  | { kind: 'projects'; projects: number }
  | { kind: 'assets'; assets: StorageAssetCounts }
  | { kind: 'data-dir'; dataDir: string }
  | { kind: 'root'; rootInfo: StorageRootInfo | null }
  | { kind: 'cache'; cacheBytes: number }

export type StorageOverviewArea =
  | 'usage'
  | 'projects'
  | 'assets'
  | 'data-dir'
  | 'root'
  | 'cache'

export interface StorageOverviewRefresh {
  done: Promise<void>
  cancel(): void
}

/**
 * 启动存储面板的增量读取。
 *
 * 快速项先发起，重统计随后并行；每一项完成后立刻发布自己的结果，任何一个慢项或失败
 * 都不会阻塞其他区块。面板只消费增量，不在这里拥有 React 状态。
 */
export function startStorageOverviewRefresh(
  source: {
    storage: StoragePort
    admin?: StorageAdminPort
  },
  handlers: {
    onUpdate(update: StorageOverviewUpdate): void
    onError?(area: StorageOverviewArea, error: unknown): void
  },
): StorageOverviewRefresh {
  let active = true
  const quick: Promise<void>[] = []

  const reportError = (area: StorageOverviewArea, error: unknown) => {
    if (active) handlers.onError?.(area, error)
  }

  const start = <T>(
    pending: Promise<void>[],
    area: StorageOverviewArea,
    read: () => Promise<T>,
    publish: (value: T) => void,
  ) => {
    pending.push(
      Promise.resolve()
        .then(read)
        .then((value) => {
          if (active) publish(value)
        })
        .catch((error: unknown) => reportError(area, error)),
    )
  }

  // 第一阶段只读轻量信息；重统计必须等它们结束，避免串行存储后端被长扫描占住。
  start(quick, 'usage', () => source.storage.estimateUsage(), (usage) => {
    handlers.onUpdate({ kind: 'usage', usage })
  })
  if (source.admin) {
    quick.push(
      (async () => {
        try {
          const dataDir = await source.admin!.dataDir()
          if (!active) return
          handlers.onUpdate({ kind: 'data-dir', dataDir })
          try {
            const rootInfo = source.admin!.inspectRoot
              ? await source.admin!.inspectRoot(dataDir)
              : null
            if (active) handlers.onUpdate({ kind: 'root', rootInfo })
          } catch (error) {
            reportError('root', error)
          }
        } catch (error) {
          reportError('data-dir', error)
        }
      })(),
    )
  }

  if (source.admin) {
    start(quick, 'cache', () => source.admin!.cacheUsage(), (cacheBytes) => {
      handlers.onUpdate({ kind: 'cache', cacheBytes })
    })
  }

  return {
    done: Promise.all(quick).then(async () => {
      if (!active) return
      const heavy: Promise<void>[] = []
      start(heavy, 'projects', () => readStorageCount(source.storage, 'projects', () => countStorageProjects(source.storage)), (projects) => {
        handlers.onUpdate({ kind: 'projects', projects })
      })
      start(heavy, 'assets', () => readStorageCount(source.storage, 'assets', () => countStorageAssets(source.storage)), (assets) => {
        handlers.onUpdate({ kind: 'assets', assets })
      })
      await Promise.all(heavy)
    }),
    cancel() {
      active = false
    },
  }
}

/** 与素材页一致：生成历史 ∪ 收藏，按素材 hash 去重。 */
export async function countStorageAssets(
  storage: StoragePort,
  now = Date.now(),
): Promise<StorageAssetCounts> {
  const [rawHistory, rawLibrary, hidden] = await Promise.all([
    createAssetHistoryRepository(storage).list(),
    storage.query('assetLibrary', {}),
    createAssetLibraryRepository(storage).listHidden(),
  ])
  const history = rawHistory.filter(
    (item) => item.kind !== 'output' || !hidden.has(item.hash),
  )
  const library = (rawLibrary as LibraryCountRow[]).filter((row) => {
    const hash =
      typeof row.hash === 'string' ? row.hash : typeof row.id === 'string' ? row.id : ''
    return !hash || !hidden.has(hash)
  })
  return countAssets(history, library, now)
}

export async function countStorageProjects(storage: StoragePort): Promise<number> {
  const scan = storage.scan?.bind(storage)
  if (!scan) {
    return (await storage.query('projects', {}, { includePayload: false })).filter(
      (row) => !row.deletedAt,
    ).length
  }
  let total = 0
  await scan(
    'projects',
    50,
    async (rows) => {
      total += rows.filter((row) => !row.deletedAt).length
    },
    { includePayload: false },
  )
  return total
}
