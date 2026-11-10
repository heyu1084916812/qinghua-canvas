import type { DesignResearchItem } from './designResearch'
import { isKnownClipperPlaceholderImageUrl } from './clipperPlaceholder'

export const CLIPPER_COLLECTION_KEY = 'clipper:collection:v1'
export const CLIPPER_MAX_ITEMS = 200
export const CLIPPER_UNCATEGORIZED = '未分类'
export const CLIPPER_CATEGORY_MAX_LENGTH = 24

export interface ClipperItem extends DesignResearchItem {
  collectedAt: number
  category: string
}
export function normalizeClipperCategory(value: unknown): string {
  return textOf(value).slice(0, CLIPPER_CATEGORY_MAX_LENGTH) || CLIPPER_UNCATEGORIZED
}
export function normalizeClipperCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const categories: string[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const category = normalizeClipperCategory(candidate)
    if (category === CLIPPER_UNCATEGORIZED || seen.has(category)) continue
    seen.add(category)
    categories.push(category)
  }
  return categories
}
export function normalizeClipperItems(value: unknown): ClipperItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: ClipperItem[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const row = candidate as Record<string, unknown>
    const id = textOf(row.id)
    const title = textOf(row.title)
    const url = httpUrlOf(row.url)
    const imageUrl = httpUrlOf(row.imageUrl)
    if (isKnownClipperPlaceholderImageUrl(imageUrl)) continue
    const imageUrls = Array.isArray(row.imageUrls)
      ? [...new Set(row.imageUrls.map(httpUrlOf).filter(Boolean))]
        .filter((candidate) => !isKnownClipperPlaceholderImageUrl(candidate))
        .filter((candidate) => candidate !== imageUrl)
        .slice(0, 7)
      : []
    const collectedAt = numberOf(row.collectedAt)
    if (!id || !title || !url || !imageUrl || collectedAt === undefined) continue
    const key = `${url}|${imageUrl}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      id,
      source: 'web',
      title,
      url,
      imageUrl,
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      ...(textOf(row.description) ? { description: textOf(row.description) } : {}),
      ...(textOf(row.credit) ? { credit: textOf(row.credit) } : {}),
      ...(textOf(row.license) ? { license: textOf(row.license) } : {}),
      ...(httpUrlOf(row.licenseUrl) ? { licenseUrl: httpUrlOf(row.licenseUrl) } : {}),
      collectedAt,
      category: normalizeClipperCategory(row.category),
    })
  }
  return items
    .sort((left, right) => right.collectedAt - left.collectedAt || left.id.localeCompare(right.id))
    .slice(0, CLIPPER_MAX_ITEMS)
}
export function upsertClipperItems(
  current: readonly ClipperItem[],
  incoming: readonly ClipperItem[],
): ClipperItem[] {
  const byKey = new Map<string, ClipperItem>()
  for (const item of [...incoming, ...current]) {
    const key = `${item.url}|${item.imageUrl}`
    if (!byKey.has(key)) byKey.set(key, item)
  }
  return normalizeClipperItems([...byKey.values()])
}
export function removeClipperItem(
  items: readonly ClipperItem[],
  itemId: string,
): ClipperItem[] {
  return items.filter((item) => item.id !== itemId)
}
export function removeClipperItems(
  items: readonly ClipperItem[],
  itemIds: readonly string[],
): ClipperItem[] {
  const removing = new Set(itemIds)
  return items.filter((item) => !removing.has(item.id))
}
export function moveClipperItems(
  items: readonly ClipperItem[],
  itemIds: readonly string[],
  category: unknown,
): ClipperItem[] {
  const moving = new Set(itemIds)
  const target = normalizeClipperCategory(category)
  return items.map((item) => moving.has(item.id) ? { ...item, category: target } : item)
}
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}
function httpUrlOf(value: unknown): string {
  const raw = textOf(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}
