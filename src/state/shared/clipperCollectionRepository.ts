import {
  CLIPPER_COLLECTION_KEY,
  normalizeClipperItems,
  upsertClipperItems,
  type ClipperItem,
} from '../../domain/inspiration/clipper'
import type { StoragePort } from '../../platform/ports'

export interface ClipperCollectionRepository {
  load(): Promise<ClipperItem[]>
  upsert(items: readonly ClipperItem[]): Promise<ClipperItem[]>
  remove(itemId: string): Promise<ClipperItem[]>
}

export function createClipperCollectionRepository(
  storage: StoragePort,
): ClipperCollectionRepository {
  const load = async () => {
    const rows = await storage.query('presets', { id: CLIPPER_COLLECTION_KEY })
    return normalizeClipperItems(rows[0]?.items)
  }
  const save = async (items: readonly ClipperItem[]) => {
    const normalized = normalizeClipperItems(items)
    await storage.put('presets', {
      id: CLIPPER_COLLECTION_KEY,
      items: normalized,
      updatedAt: Date.now(),
    })
    return normalized
  }
  return {
    load,
    async upsert(items) {
      return save(upsertClipperItems(await load(), items))
    },
    async remove(itemId) {
      return save((await load()).filter((item) => item.id !== itemId))
    },
  }
}
