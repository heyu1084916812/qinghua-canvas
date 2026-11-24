import type { LightboxSourceRectSnapshot } from '../../domain/canvas/model/lightbox'

export interface LightboxSourceRect extends LightboxSourceRectSnapshot {
  borderRadius: string
  kind: 'image' | 'video'
  assetHash: string
}

export function lightboxSourceRectFromMedia(
  media: HTMLElement,
  assetHash: string,
  borderRadius: string,
): LightboxSourceRect | undefined {
  const rect = media.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return undefined
  const video = media.tagName === 'VIDEO'
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius,
    src: video
      ? media.getAttribute('src') ?? undefined
      : (media as HTMLImageElement).currentSrc || (media as HTMLImageElement).src,
    kind: video ? 'video' : 'image',
    assetHash,
  }
}

/** Same source snapshot for double-click, toolbar preview, and every node event entry. */
export function lightboxSourceRectForNode(
  nodeId: string,
  assetHash: string | undefined,
  root: ParentNode = document,
): LightboxSourceRect | undefined {
  if (!assetHash) return undefined
  const media = root.querySelector<HTMLElement>(
    `[data-node-id="${CSS.escape(nodeId)}"] img, [data-node-id="${CSS.escape(nodeId)}"] video`,
  )
  if (!media) return undefined
  return lightboxSourceRectFromMedia(
    media,
    assetHash,
    getComputedStyle(media).borderRadius,
  )
}
