import type {
  StorageAdminPort,
  StoragePort,
  StorageRootInfo,
} from '../../platform/ports'
import {
  countStorageAssets,
  type StorageAssetCounts,
} from './storageOverviewAssetCount'
import { countStorageProjects } from './storageOverviewProjectCount'
import { readStorageCount } from './storageOverviewReadDedup'

export interface StorageUsage {
  used: number
  quota: number
}

export { countStorageAssets, type StorageAssetCounts } from './storageOverviewAssetCount'

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
  const earlyProjects: Promise<void>[] = []

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

  // `queryPage` 的 total 是一次元数据查询，不应等桌面目录 / 缓存检查结束；
  // 旧后端的 scan 仍留到快速项之后，避免全表扫描占住串行存储锁。
  if (source.storage.queryPage) {
    start(
      earlyProjects,
      'projects',
      () => readStorageCount(source.storage, 'projects', () => countStorageProjects(source.storage)),
      (projects) => {
        handlers.onUpdate({ kind: 'projects', projects })
      },
    )
  }

  return {
    done: Promise.all([...quick, ...earlyProjects]).then(async () => {
      if (!active) return
      const heavy: Promise<void>[] = []
      if (!source.storage.queryPage) {
        start(heavy, 'projects', () => readStorageCount(source.storage, 'projects', () => countStorageProjects(source.storage)), (projects) => {
          handlers.onUpdate({ kind: 'projects', projects })
        })
      }
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
