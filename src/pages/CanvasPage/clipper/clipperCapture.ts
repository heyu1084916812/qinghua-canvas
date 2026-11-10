import type { ClipperItem } from '../../../domain/inspiration/clipper'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { runDesignResearch } from '../../../features/shared/research/designResearchRunner'
import type { NetworkPort } from '../../../platform/ports'
import type { ClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'

export interface ClipperCaptureResult {
  items: ClipperItem[]
  collection: ClipperItem[]
  warnings: string[]
}

export async function capturePendingClipperClip(input: {
  pageUrl: string
  imageUrl?: string
  title?: string
  network: NetworkPort
  collection: ClipperCollectionRepository
  signal: AbortSignal
}): Promise<ClipperCaptureResult> {
  if (input.imageUrl) {
    return captureClipperImage({
      pageUrl: input.pageUrl,
      imageUrl: input.imageUrl,
      title: input.title,
      collection: input.collection,
    })
  }
  return captureClipperPage({
    url: input.pageUrl,
    network: input.network,
    collection: input.collection,
    signal: input.signal,
  })
}

export async function captureClipperImage(input: {
  pageUrl: string
  imageUrl: string
  title?: string
  collection: ClipperCollectionRepository
}): Promise<ClipperCaptureResult> {
  if (!isPublicHttpUrl(input.pageUrl) || !isPublicHttpUrl(input.imageUrl)) {
    throw new Error('拖入的图片地址不是公开 HTTP / HTTPS 地址')
  }
  const now = Date.now()
  const item: ClipperItem = {
    id: `web:dropped:${stableHash(`${input.pageUrl}|${input.imageUrl}`)}`,
    source: 'web',
    title: cleanImageTitle(input.title, input.pageUrl),
    url: input.pageUrl,
    imageUrl: input.imageUrl,
    collectedAt: now,
    category: '未分类',
  }
  return {
    items: [item],
    collection: await input.collection.upsert([item]),
    warnings: [],
  }
}

export async function captureClipperPage(input: {
  url: string
  network: NetworkPort
  collection: ClipperCollectionRepository
  signal: AbortSignal
  maxResults?: number
}): Promise<ClipperCaptureResult> {
  const result = await runDesignResearch(
    {
      topic: input.url,
      urls: [input.url],
      maxResults: input.maxResults ?? 24,
      includeOpenSearch: false,
    },
    { network: input.network, libraryCases: [] },
    input.signal,
  )
  const now = Date.now()
  const items = result.items
    .filter((item) =>
      isPublicHttpUrl(item.url) && isPublicHttpUrl(item.imageUrl),
    )
    .map((item, index): ClipperItem => ({
      ...item,
      source: 'web',
      collectedAt: now + index,
      category: '未分类',
    }))
  return {
    items,
    collection: items.length > 0
      ? await input.collection.upsert(items)
      : await input.collection.load(),
    warnings: result.warnings,
  }
}

function cleanImageTitle(title: string | undefined, pageUrl: string): string {
  const cleaned = (title ?? '').replace(/\s+/g, ' ').trim()
  if (cleaned) return cleaned.slice(0, 300)
  try {
    return new URL(pageUrl).hostname
  } catch {
    return '网页图片'
  }
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
