/** 灯箱画廊、素材详情与初始模式的只读派生。 */
import type { LightboxEditorMode } from './lightboxKeyboard'

export interface LightboxGalleryItem {
  assetHash: string
  nodeId: string
  title: string
}

export interface LightboxStateLike {
  assetHash?: string
  gallery?: readonly LightboxGalleryItem[]
  galleryIndex?: number
  cropFor?: string
  faceFor?: string
  cropPlain?: boolean
  rotateFor?: string
  annotateFor?: string
  compareWith?: string
  compareKind?: 'pair' | 'result'
}

export function galleryViewOf(lightbox: LightboxStateLike | null) {
  const gallery = lightbox?.gallery ?? []
  const galleryIndex = lightbox?.galleryIndex ?? 0
  return {
    gallery,
    galleryIndex,
    galleryItem: gallery[galleryIndex],
    hasGalleryNavigation: gallery.length > 1,
  }
}

export function ownerNodeOf(
  nodes: readonly { id: string; title?: string; data?: unknown }[],
  assetHash: string | undefined,
): { id: string; title?: string } | undefined {
  if (!assetHash) return undefined
  return nodes.find((node) => {
    const data = node.data as { assetHash?: unknown } | undefined
    return data?.assetHash === assetHash
  })
}

export function compareHashOf(
  nodes: readonly { data?: unknown }[],
  assetHash: string | undefined,
  explicit?: string,
): string | null {
  if (explicit) return explicit
  if (!assetHash) return null
  for (const node of nodes) {
    const data = node.data as { assetHash?: string; compareWith?: string } | undefined
    if (data?.assetHash === assetHash && data.compareWith) return data.compareWith
  }
  return null
}

export function initialEditorModeOf(input: {
  assetHash: string | undefined
  faceFor?: string
  cropFor?: string
  cropPlain?: boolean
  rotateFor?: string
  annotateFor?: string
  compareWith?: string
  nodeHasComparePair: boolean
}): LightboxEditorMode {
  if (!input.assetHash) return 'view'
  if (input.faceFor) return 'face'
  if (input.cropFor) return input.cropPlain ? 'crop' : 'extract'
  if (input.rotateFor) return 'rotate'
  if (input.annotateFor) return 'annotate'
  if (input.compareWith || input.nodeHasComparePair) return 'compare'
  return 'view'
}

export function availableEditorModes(input: {
  canCrop: boolean
  canAnnotate: boolean
  canRotate: boolean
  compareAvailable: boolean
  faceFor?: string
}): LightboxEditorMode[] {
  return [
    'view' as const,
    ...(input.canCrop && !input.faceFor ? (['extract', 'crop'] as const) : []),
    ...(input.canCrop && input.faceFor ? (['face'] as const) : []),
    ...(input.canAnnotate ? (['annotate'] as const) : []),
    ...(input.canRotate ? (['rotate'] as const) : []),
    ...(input.compareAvailable ? (['compare'] as const) : []),
  ]
}
