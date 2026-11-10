import type { ClipperItem } from '../../../domain/inspiration/clipper'
import { DESIGN_RESEARCH_MAX_IMAGE_PIXELS } from '../../../domain/inspiration/designResearch'
import { imageMimeFromBytes } from '../../../domain/shared/imageMime'
import { imageSizeFromHeader } from '../../../domain/shared/imageSize'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { runDesignResearch } from '../../../features/shared/research/designResearchRunner'
import type { NetworkPort } from '../../../platform/ports'
import type { ClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'

export interface ClipperCaptureResult { items: ClipperItem[]; collection: ClipperItem[]; warnings: string[] }
interface CaptureDeps { network: NetworkPort; collection: ClipperCollectionRepository; signal: AbortSignal }
type PendingClipInput = CaptureDeps & { pageUrl: string; imageUrl?: string; title?: string }
type ImageInput = PendingClipInput & { imageUrl: string }
type PageInput = CaptureDeps & { url: string; maxResults?: number }

export class ClipperCaptureError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message)
    this.name = 'ClipperCaptureError'
  }
}

export async function capturePendingClipperClip(input: PendingClipInput): Promise<ClipperCaptureResult> {
  if (input.imageUrl) {
    return captureClipperImage({
      pageUrl: input.pageUrl,
      imageUrl: input.imageUrl,
      title: input.title,
      network: input.network,
      signal: input.signal,
      collection: input.collection,
    })
  }
  throw new ClipperCaptureError('没有识别到拖拽的图片，请重新从网页图片上拖入', false)
}

export async function captureClipperImage(input: ImageInput): Promise<ClipperCaptureResult> {
  if (!isPublicHttpUrl(input.pageUrl) || !isPublicHttpUrl(input.imageUrl)) {
    throw new ClipperCaptureError('拖入的图片地址不是公开 HTTP / HTTPS 地址', false)
  }
  if (samePageUrl(input.pageUrl, input.imageUrl)) {
    throw new ClipperCaptureError('把网页地址当成了图片地址，请在图片本身上拖动', false)
  }
  await validateClipperImage(input)
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

async function validateClipperImage(input: Pick<ImageInput, 'pageUrl' | 'imageUrl' | 'network' | 'signal'>) {
  const response = await input.network.request({
    url: input.imageUrl,
    method: 'GET',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: input.pageUrl,
    },
    publicOnly: true,
    maxResponseBytes: 32 * 1024 * 1024,
    timeoutMs: 30_000,
  }, input.signal)
  if (response.status < 200 || response.status >= 300) {
    throw new ClipperCaptureError(
      `图片读取失败：HTTP ${response.status}`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    )
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const mime = imageMimeFromBytes(bytes)
  if (!mime) throw new ClipperCaptureError('没有识别到可导入的图片', false)
  const size = imageSizeFromHeader(bytes)
  if (!size || size.width < 2 || size.height < 2) {
    throw new ClipperCaptureError('图片尺寸无效，无法导入', false)
  }
  if (size.width * size.height > DESIGN_RESEARCH_MAX_IMAGE_PIXELS) {
    throw new ClipperCaptureError('图片超过 2000 万像素，已拒绝导入', false)
  }
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

function samePageUrl(pageUrl: string, imageUrl: string): boolean {
  try {
    const page = new URL(pageUrl)
    const image = new URL(imageUrl)
    return page.origin === image.origin
      && page.pathname === image.pathname
      && page.search === image.search
  } catch {
    return false
  }
}
