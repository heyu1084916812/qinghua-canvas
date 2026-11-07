import type { StoragePort } from '../../platform/ports'

type StorageCountArea = 'projects' | 'assets'

const storageCountReads = new WeakMap<
  StoragePort,
  Map<StorageCountArea, Promise<unknown>>
>()

/**
 * StrictMode 或设置页重挂载会同时启动两轮概览；计数只复用进行中的同一份读取。
 * 完成后立即释放，不做结果缓存，下一次显式刷新仍读到最新库状态。
 */
export function readStorageCount<T>(
  storage: StoragePort,
  area: StorageCountArea,
  read: () => Promise<T>,
): Promise<T> {
  let reads = storageCountReads.get(storage)
  if (!reads) {
    reads = new Map()
    storageCountReads.set(storage, reads)
  }
  const existing = reads.get(area)
  if (existing) return existing as Promise<T>

  const pending = Promise.resolve().then(read)
  reads.set(area, pending)
  const clear = () => {
    if (reads?.get(area) !== pending) return
    reads.delete(area)
    if (reads.size === 0) storageCountReads.delete(storage)
  }
  void pending.then(clear, clear)
  return pending
}
