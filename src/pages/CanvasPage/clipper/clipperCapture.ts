import type { ClipperItem } from '../../../domain/inspiration/clipper'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { runDesignResearch } from '../../../features/shared/research/designResearchRunner'
import type { NetworkPort } from '../../../platform/ports'
import {
  ClipperCaptureError,
  samePageUrl,
  validateClipperImage,
} from './clipperImageValidation'
import { validateClipperImageCandidates } from './clipperCandidateValidation'
import type { ClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'

export interface ClipperCaptureResult { items: ClipperItem[]; collection: ClipperItem[]; warnings: string[] }
interface CaptureDeps { network: NetworkPort; collection: ClipperCollectionRepository; signal: AbortSignal }
type PendingClipInput = CaptureDeps & { pageUrl: string; imageUrl?: string; title?: string }
type ImageInput = PendingClipInput & { imageUrl: string }
type CandidateInput = CaptureDeps & {
  pageUrl: string
  imageUrls: readonly string[]
  title?: string
}
type PendingImageInput = PendingClipInput & {
  imageUrl?: string
  imageUrls?: readonly string[]
}
type PageInput = CaptureDeps & { url: string; maxResults?: number }

export async function capturePendingClipperClip(input: PendingImageInput): Promise<ClipperCaptureResult> {
  const imageUrls = [...new Set([
    ...(input.imageUrl ? [input.imageUrl] : []),
    ...(input.imageUrls ?? []),
  ])].slice(0, 8)
  if (imageUrls.length === 0) {
    throw new ClipperCaptureError('没有识别到拖拽的图片，请重新从网页图片上拖入', false)
  }
  return captureClipperImageCandidates({
    pageUrl: input.pageUrl,
    imageUrls,
    title: input.title,
    network: input.network,
    signal: input.signal,
    collection: input.collection,
  })
}

export async function captureClipperImage(input: ImageInput): Promise<ClipperCaptureResult> {
  return captureClipperImageCandidates({ ...input, imageUrls: [input.imageUrl] })
}

async function captureClipperImageCandidates(input: CandidateInput): Promise<ClipperCaptureResult> {
  if (!isPublicHttpUrl(input.pageUrl)) {
    throw new ClipperCaptureError('拖入的图片地址不是公开 HTTP / HTTPS 地址', false)
  }
  const failures: ClipperCaptureError[] = []
  for (const imageUrl of input.imageUrls) {
    if (!isPublicHttpUrl(imageUrl)) {
      failures.push(new ClipperCaptureError('拖入的图片地址不是公开 HTTP / HTTPS 地址', false))
      continue
    }
    if (samePageUrl(input.pageUrl, imageUrl)) {
      failures.push(new ClipperCaptureError('把网页地址当成了图片地址，请在图片本身上拖动', false))
      continue
    }
    try {
      await validateClipperImage({ ...input, imageUrl })
    } catch (error) {
      failures.push(error instanceof ClipperCaptureError
        ? error
        : new ClipperCaptureError(error instanceof Error ? error.message : String(error), true))
      continue
    }
    const now = Date.now()
    const item: ClipperItem = {
      id: `web:dropped:${stableHash(`${input.pageUrl}|${imageUrl}`)}`,
      source: 'web',
      title: cleanImageTitle(input.title, input.pageUrl),
      url: input.pageUrl,
      imageUrl,
      imageUrls: input.imageUrls.filter((candidate) => candidate !== imageUrl).slice(0, 7),
      collectedAt: now,
      category: '未分类',
    }
    return {
      items: [item],
      collection: await input.collection.upsert([item]),
      warnings: failures.length > 0 ? ['原图地址不可用，已使用备用地址'] : [],
    }
  }
  const last = failures.at(-1)
  throw new ClipperCaptureError(
    last?.message || '没有识别到可导入的图片',
    failures.some((failure) => failure.retryable),
  )
}

export async function captureClipperPage(input: PageInput): Promise<ClipperCaptureResult> {
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
  const candidates = result.items
    .filter((item) =>
      isPublicHttpUrl(item.url) && isPublicHttpUrl(item.imageUrl),
    )
    .slice(0, input.maxResults ?? 12)
  const validation = await validateClipperImageCandidates({
    pageUrl: input.url,
    imageUrls: candidates.map((item) => item.imageUrl),
    network: input.network,
    signal: input.signal,
  })
  const warnings = [...result.warnings, ...validation.warnings]
  const validItems = candidates.filter((item) => validation.validUrls.has(item.imageUrl))
  if (candidates.length > 0 && validItems.length === 0 && !warnings.some(
    (warning) => warning.includes('分享图') || warning.includes('占位图'),
  )) {
    warnings.push('页面只返回了无法直接保存的图片，请改用轻画 Clipper 从图片本体拖拽')
  }
  const now = Date.now()
  const items = validItems
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
    warnings,
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
