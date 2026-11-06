import type { LightboxEditorMode } from './lightboxKeyboard'
import {
  availableEditorModes,
  ownerNodeOf,
  type LightboxStateLike,
} from './lightboxGallery'
import { EDITOR_MODES } from './lightboxCatalog'

type LightboxNodeLike = Parameters<typeof ownerNodeOf>[0][number]

export interface LightboxEditorProjectionInput {
  nodes: readonly LightboxNodeLike[]
  assetHash?: string
  isVideo: boolean
  mode: LightboxEditorMode
  lightbox: LightboxStateLike | null
  compareAvailable: boolean
}

export function lightboxEditorProjectionOf(input: LightboxEditorProjectionInput) {
  const cropFor = input.lightbox?.cropFor
  const faceFor = input.lightbox?.faceFor
  const cropPlainRequested = input.lightbox?.cropPlain === true
  const ownerNode = ownerNodeOf(input.nodes, input.assetHash)
  const ownerNodeId = ownerNode?.id ?? ''
  const cropNodeId = cropFor ?? faceFor ?? ownerNodeId
  const rotateNodeId = input.lightbox?.rotateFor ?? ownerNodeId
  const annotateNodeId = input.lightbox?.annotateFor ?? ownerNodeId
  const canCrop = !input.isVideo && !!cropNodeId
  const canAnnotate = !input.isVideo && !!annotateNodeId
  const canRotate = !input.isVideo && !!rotateNodeId
  const cropping =
    (input.mode === 'extract' || input.mode === 'crop' || input.mode === 'face') &&
    canCrop
  const plainCrop = input.mode === 'crop'
  const rotating = input.mode === 'rotate' && canRotate
  const annotating = input.mode === 'annotate' && canAnnotate
  const availableModeIds = new Set(availableEditorModes({
    canCrop,
    canAnnotate,
    canRotate,
    compareAvailable: input.compareAvailable,
    faceFor,
  }))
  const availableModes = EDITOR_MODES.filter((mode) => availableModeIds.has(mode.id))

  return {
    cropFor,
    faceFor,
    cropPlainRequested,
    ownerNode,
    ownerNodeId,
    cropNodeId,
    rotateNodeId,
    annotateNodeId,
    canCrop,
    canAnnotate,
    canRotate,
    cropping,
    plainCrop,
    rotating,
    annotating,
    availableModes,
  }
}
