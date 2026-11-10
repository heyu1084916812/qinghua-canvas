import { DESIGN_RESEARCH_MAX_IMAGE_PIXELS } from '../../../domain/inspiration/designResearch'
import { isKnownClipperPlaceholderImageUrl } from '../../../domain/inspiration/clipperPlaceholder'
import { imageMimeFromBytes } from '../../../domain/shared/imageMime'
import { imageSizeFromHeader } from '../../../domain/shared/imageSize'
import type { NetworkPort } from '../../../platform/ports'

const MIN_CLIPPER_IMAGE_EDGE = 64

export class ClipperCaptureError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message)
    this.name = 'ClipperCaptureError'
  }
}

export function samePageUrl(pageUrl: string, imageUrl: string): boolean {
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

export async function validateClipperImage(input: {
  pageUrl: string
  imageUrl: string
  network: NetworkPort
  signal: AbortSignal
}) {
  if (isKnownClipperPlaceholderImageUrl(input.imageUrl)) {
    throw new ClipperCaptureError(
      '这是网站的分享图或占位图，不是页面内容图片',
      false,
    )
  }
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
  if (size.width < MIN_CLIPPER_IMAGE_EDGE && size.height < MIN_CLIPPER_IMAGE_EDGE) {
    throw new ClipperCaptureError('图片太小，可能是站点图标或占位图', false)
  }
  if (size.width * size.height > DESIGN_RESEARCH_MAX_IMAGE_PIXELS) {
    throw new ClipperCaptureError('图片超过 2000 万像素，已拒绝导入', false)
  }
}
