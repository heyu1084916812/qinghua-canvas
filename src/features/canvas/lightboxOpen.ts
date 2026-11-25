import type { CanvasStore } from '../../state/workbenches/canvas/store'
import {
  lightboxSourceRectForNode,
  lightboxSourceRectForThumbnail,
} from './lightboxSourceRect'

// Production view-lightbox callers enter through these adapters. A future source
// type adds one adapter here; animation remains owned by LightboxLayer.
type OpenLightboxStore = Pick<CanvasStore, 'openLightbox'>
type OpenLightboxOptions = NonNullable<Parameters<CanvasStore['openLightbox']>[1]>

export type NodeLightboxOptions = Omit<OpenLightboxOptions, 'sourceNodeId' | 'sourceRect'>
export type ThumbnailLightboxOptions = Omit<OpenLightboxOptions, 'sourceRect'>

export function openNodeLightbox(
  store: OpenLightboxStore,
  nodeId: string,
  assetHash: string | undefined,
  options: NodeLightboxOptions = {},
): void {
  if (!assetHash) return
  store.openLightbox(assetHash, {
    ...options,
    sourceNodeId: nodeId,
    sourceRect: lightboxSourceRectForNode(nodeId, assetHash),
  })
}

export function openThumbnailLightbox(
  store: OpenLightboxStore,
  host: HTMLElement,
  assetHash: string,
  options: ThumbnailLightboxOptions = {},
): void {
  if (!assetHash) return
  store.openLightbox(assetHash, {
    ...options,
    sourceRect: lightboxSourceRectForThumbnail(host, assetHash),
  })
}
