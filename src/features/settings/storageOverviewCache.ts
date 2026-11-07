import type { StoragePort, StorageRootInfo } from '../../platform/ports'
import type {
  StorageAssetCounts,
  StorageOverviewUpdate,
  StorageUsage,
} from './storageOverviewRefresh'

export interface StorageOverviewSnapshot {
  usage?: StorageUsage
  projects?: number
  assets?: StorageAssetCounts
  dataDir?: string
  rootInfo?: StorageRootInfo | null
  cacheBytes?: number
}

const snapshots = new WeakMap<StoragePort, StorageOverviewSnapshot>()

/** Read the last in-session values so reopening the panel has no blank frame. */
export function readStorageOverviewSnapshot(
  storage: StoragePort,
): StorageOverviewSnapshot | null {
  return snapshots.get(storage) ?? null
}

/** Store one independently published field; refresh still remains authoritative. */
export function rememberStorageOverviewUpdate(
  storage: StoragePort,
  update: StorageOverviewUpdate,
): void {
  const current = snapshots.get(storage) ?? {}
  if (update.kind === 'usage') snapshots.set(storage, { ...current, usage: update.usage })
  else if (update.kind === 'projects') snapshots.set(storage, { ...current, projects: update.projects })
  else if (update.kind === 'assets') snapshots.set(storage, { ...current, assets: update.assets })
  else if (update.kind === 'data-dir') snapshots.set(storage, { ...current, dataDir: update.dataDir })
  else if (update.kind === 'root') snapshots.set(storage, { ...current, rootInfo: update.rootInfo })
  else snapshots.set(storage, { ...current, cacheBytes: update.cacheBytes })
}
