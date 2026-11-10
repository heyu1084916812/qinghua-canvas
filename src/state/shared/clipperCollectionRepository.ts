import {
  CLIPPER_COLLECTION_KEY,
  CLIPPER_UNCATEGORIZED,
  moveClipperItems,
  normalizeClipperCategories,
  normalizeClipperCategory,
  normalizeClipperItems,
  removeClipperItems,
  upsertClipperItems,
  type ClipperItem,
} from '../../domain/inspiration/clipper'
import type { StoragePort } from '../../platform/ports'

export interface ClipperCollectionState { items: ClipperItem[]; categories: string[] }
export interface ClipperCollectionRepository {
  load(): Promise<ClipperItem[]>; loadState(): Promise<ClipperCollectionState>
  upsert(items: readonly ClipperItem[]): Promise<ClipperItem[]>
  remove(itemId: string): Promise<ClipperItem[]>
  removeMany(itemIds: readonly string[]): Promise<ClipperCollectionState>
  createCategory(name: string): Promise<ClipperCollectionState>
  moveMany(itemIds: readonly string[], category: string): Promise<ClipperCollectionState>
}
export function createClipperCollectionRepository(storage: StoragePort): ClipperCollectionRepository {
  const read = async (): Promise<ClipperCollectionState> => {
    const rows = await storage.query('presets', { id: CLIPPER_COLLECTION_KEY })
    const items = normalizeClipperItems(rows[0]?.items)
    const categories = normalizeClipperCategories(rows[0]?.categories)
    for (const item of items) if (
      item.category !== CLIPPER_UNCATEGORIZED && !categories.includes(item.category)
    ) categories.push(item.category)
    return { items, categories }
  }
  const save = async (items: readonly ClipperItem[], categories: readonly string[]) => {
    const state = { items: normalizeClipperItems(items), categories: normalizeClipperCategories(categories) }
    await storage.put('presets', { id: CLIPPER_COLLECTION_KEY, ...state, updatedAt: Date.now() })
    return state
  }
  return {
    async load() { return (await read()).items },
    loadState: read,
    async upsert(items) {
      const current = await read()
      return (await save(upsertClipperItems(current.items, items), current.categories)).items
    },
    async remove(itemId) {
      const current = await read()
      return (await save(removeClipperItems(current.items, [itemId]), current.categories)).items
    },
    async removeMany(itemIds) { const current = await read(); return save(removeClipperItems(current.items, itemIds), current.categories) },
    async createCategory(name) {
      const current = await read()
      const category = normalizeClipperCategory(name)
      if (category === CLIPPER_UNCATEGORIZED || category === '全部') {
        throw new Error('分类名称不能为空、“全部”或“未分类”')
      }
      return current.categories.includes(category)
        ? current : save(current.items, [...current.categories, category])
    },
    async moveMany(itemIds, category) {
      const current = await read()
      const target = normalizeClipperCategory(category)
      const categories = target === CLIPPER_UNCATEGORIZED
        || current.categories.includes(target)
        ? current.categories
        : [...current.categories, target]
      return save(moveClipperItems(current.items, itemIds, target), categories)
    },
  }
}
