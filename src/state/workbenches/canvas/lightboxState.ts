import type { LightboxSourceRectSnapshot } from '../../../domain/canvas/model/lightbox'

/**
 * Shared transient lightbox state. Media viewing, crop / face framing, rotate,
 * annotate and compare all use this one shape so every entry carries the same
 * source metadata and FLIP snapshot.
 */
export interface CanvasLightboxState {
  assetHash: string
  /** Preferred node for the FLIP start when several nodes share the asset. */
  sourceNodeId?: string
  /** Pointer-time snapshot captured before opening React state changes. */
  sourceRect?: LightboxSourceRectSnapshot
  gallery?: {
    assetHash: string
    nodeId: string
    title: string
  }[]
  galleryIndex?: number
  cropFor?: string
  /** `true` means crop; omitted means extract selection with context. */
  cropPlain?: boolean
  faceFor?: string
  compareWith?: string
  compareKind?: 'result' | 'pair'
  rotateFor?: string
  annotateFor?: string
}
