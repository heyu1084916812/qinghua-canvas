import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { FUSION_MIN_EDGE } from '../../../domain/canvas/fusion/fusionPlan'
import type { FusionRect } from '../../../domain/canvas/model/node'
import type { CompareView, LightboxEditorMode } from './lightboxKeyboard'
import { compareHashOf } from './lightboxGallery'
import {
  compareClipPathOf,
  compareViewOf,
  compareViewsOf,
} from './lightboxEditState'
import {
  cropBoxOf,
  mediaBoxOf,
  type MediaBox,
} from './lightboxViewportMath'

type LightboxNodeLike = Parameters<typeof compareHashOf>[0][number]
type LightboxCompareKind = 'pair' | 'result'

export function lightboxCompareSourceOf(input: {
  nodes: readonly LightboxNodeLike[]
  assetHash?: string
  compareWith?: string
  compareKind: LightboxCompareKind | undefined
}) {
  return {
    compareHash: compareHashOf(input.nodes, input.assetHash, input.compareWith),
    compareKind: input.compareKind === 'pair' ? 'pair' as const : 'result' as const,
  }
}

export function lightboxCompareAvailableOf(input: {
  compareHash: string | null
  compareUrl: string | null
  isVideo: boolean
  compareIsVideo: boolean
}): boolean {
  return !!input.compareHash && !!input.compareUrl && !input.isVideo && !input.compareIsVideo
}

export interface LightboxMediaProjectionInput {
  assetHash?: string
  url: string | null
  isVideo: boolean
  compareHash: string | null
  compareUrl: string | null
  compareIsVideo: boolean
  compareKind: LightboxCompareKind
  compareView: CompareView
  splitRatio: number
  mode: LightboxEditorMode
  rotating: boolean
  cropping: boolean
  angle: number
  mirrorH: boolean
  mirrorV: boolean
  cropRect: FusionRect | null
  natural: { w: number; h: number } | null
  viewport: Viewport | null
}

export function lightboxMediaProjectionOf(input: LightboxMediaProjectionInput) {
  const compareAvailable = lightboxCompareAvailableOf(input)
  const view = compareViewOf(input.mode, compareAvailable, input.compareView)
  const splitActive = view === 'split'
  const showSecondOnly = view === 'second'
  const compareViews = compareViewsOf(input.compareKind)
  const compareLeftHash = input.compareKind === 'pair' ? input.assetHash : input.compareHash
  const compareRightHash = input.compareKind === 'pair' ? input.compareHash : input.assetHash
  const primaryUrl = showSecondOnly ? (input.compareUrl ?? input.url) : input.url
  const primaryIsVideo = showSecondOnly ? input.compareIsVideo : input.isVideo
  const compareClipPath = compareClipPathOf(input.compareKind, input.splitRatio)
  const box =
    input.natural && input.viewport
      ? mediaBoxOf(input.natural, input.viewport)
      : undefined
  const normalizedAngle = ((input.angle % 360) + 360) % 360
  const mediaStyle: MediaBox & {
    transformOrigin?: string
    transform?: string
  } | undefined = input.rotating && box
    ? {
        ...box,
        transformOrigin: '50% 50%',
        transform: `rotate(${input.angle}deg) scaleX(${input.mirrorH ? -1 : 1}) scaleY(${input.mirrorV ? -1 : 1})`,
      }
    : box
  const cropBox =
    input.natural && input.viewport
      ? cropBoxOf(input.cropRect, input.viewport)
      : undefined
  const canConfirm =
    input.cropping &&
    !!input.cropRect &&
    Math.min(input.cropRect.w, input.cropRect.h) >= FUSION_MIN_EDGE

  return {
    compareAvailable,
    view,
    splitActive,
    showSecondOnly,
    compareViews,
    compareLeftHash,
    compareRightHash,
    primaryUrl,
    primaryIsVideo,
    compareClipPath,
    box,
    normalizedAngle,
    mediaStyle,
    cropBox,
    canConfirm,
  }
}
