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
