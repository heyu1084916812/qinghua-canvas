import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import { splitRatioAt } from './lightboxEditState'
import {
  isMiddlePointer,
  isPrimaryPointer,
  type CompareView,
} from './lightboxKeyboard'
import {
  DRAG_SLOP,
  dragPan,
  fitMediaViewport,
  wheelZoom,
  type MediaBox,
} from './lightboxViewportMath'

export interface LightboxViewportPointer {
  button: number
  clientX: number
  clientY: number
  stopPropagation(): void
  preventDefault(): void
}

export interface LightboxViewportWheel {
  deltaY: number
  clientX: number
  clientY: number
  preventDefault(): void
}

export interface LightboxViewportPointerDragHandlers {
  onMove(point: { clientX: number; clientY: number }): void
  onUp(): void
}

interface MediaSize {
  w: number
  h: number
}

export interface LightboxViewportGesturePorts {
  stageRect(): Rect | null
  setStage(stage: Rect | null): void
  setNatural(natural: MediaSize | null): void
  setViewport(viewport: Viewport | null): void
  setCompareView(view: CompareView): void
  setSplitRatio(ratio: number): void
  setMoved(moved: boolean): void
  previousAssetHash(): string | undefined
  setPreviousAssetHash(assetHash: string | undefined): void
  setPreserveViewportAfterMediaLoad(preserve: boolean): void
  preserveViewportAfterMediaLoad(): boolean
  clearPreserveViewportAfterMediaLoad(): void
  startCrop(event: LightboxViewportPointer): void
  subscribeResize(listener: () => void): () => void
  subscribePointerDrag(handlers: LightboxViewportPointerDragHandlers): () => void
}

interface ActivePointerDrag {
  active: boolean
  release(): void
}

export function createLightboxViewportGestureCoordinator(
  ports: LightboxViewportGesturePorts,
) {
  let activeDrag: ActivePointerDrag | null = null

  const releaseActiveDrag = () => {
    const current = activeDrag
    if (!current?.active) return
    current.active = false
    activeDrag = null
    current.release()
  }

  const beginPointerDrag = (
    onMove: (point: { clientX: number; clientY: number }) => void,
  ) => {
    releaseActiveDrag()
    const current: ActivePointerDrag = { active: true, release: () => undefined }
    activeDrag = current
    const end = () => {
      if (!current.active) return
      current.active = false
      if (activeDrag === current) activeDrag = null
      current.release()
    }
    current.release = ports.subscribePointerDrag({ onMove, onUp: end })
    if (!current.active) current.release()
  }

  const watchStage = (assetHash: string | undefined) => {
    if (!assetHash) {
      ports.setStage(null)
      return
    }
    const measure = () => ports.setStage(ports.stageRect())
    measure()
    return ports.subscribeResize(measure)
  }

  const prepareAssetSwitch = (
    assetHash: string | undefined,
    hasGalleryNavigation: boolean,
  ) => {
    const previous = ports.previousAssetHash()
    const switchingGalleryFrame = !!previous && previous !== assetHash && hasGalleryNavigation
    ports.setPreviousAssetHash(assetHash)
    if (switchingGalleryFrame) {
      ports.setPreserveViewportAfterMediaLoad(true)
      return
    }
    ports.setPreserveViewportAfterMediaLoad(false)
    ports.setNatural(null)
    ports.setViewport(null)
  }

  const resetCompareView = (hasComparePair: boolean) => {
    ports.setCompareView(hasComparePair ? 'split' : 'first')
    ports.setSplitRatio(0.5)
  }

  const fitInitialViewport = (
    natural: MediaSize | null,
    stage: Rect | null,
    viewport: Viewport | null,
  ) => {
    if (!natural || !stage || stage.w === 0 || stage.h === 0 || viewport) return
    ports.setViewport(fitMediaViewport(natural, stage))
  }

  const wheel = (event: LightboxViewportWheel, viewport: Viewport | null) => {
    const stage = ports.stageRect()
    if (!viewport || !stage) return
    event.preventDefault()
    ports.setViewport(wheelZoom(
      viewport,
      event.deltaY,
      event.clientX,
      event.clientY,
      stage,
    ))
  }

  const pointerDown = (
    event: LightboxViewportPointer,
    snapshot: { viewport: Viewport | null; cropping: boolean },
  ) => {
    if (!snapshot.viewport) return
    if (snapshot.cropping && isPrimaryPointer(event.button)) {
      ports.startCrop(event)
      return
    }
    if (isMiddlePointer(event.button)) event.preventDefault()
    ports.setMoved(false)
    const start = { x: event.clientX, y: event.clientY }
    let last = start
    let current = snapshot.viewport
    beginPointerDrag((point) => {
      const dx = point.clientX - last.x
      const dy = point.clientY - last.y
      last = { x: point.clientX, y: point.clientY }
      if (Math.abs(point.clientX - start.x) + Math.abs(point.clientY - start.y) > DRAG_SLOP) {
        ports.setMoved(true)
      }
      current = dragPan(current, dx, dy)
      ports.setViewport(current)
    })
  }

  const settleMediaSize = (
    width: number,
    height: number,
    viewport: Viewport | null,
  ) => {
    const natural = { w: width, h: height }
    ports.setNatural(natural)
    if (!ports.preserveViewportAfterMediaLoad()) return
    ports.clearPreserveViewportAfterMediaLoad()
    if (viewport) return
    const stage = ports.stageRect()
    if (!stage) return
    ports.setViewport(fitMediaViewport(natural, stage))
  }

  const startSplitDrag = (
    event: LightboxViewportPointer,
    snapshot: { mediaBox: MediaBox | undefined; splitRatio: number },
  ) => {
    event.stopPropagation()
    event.preventDefault()
    ports.setMoved(true)
    const stage = ports.stageRect()
    if (!stage) return
    beginPointerDrag((point) => {
      ports.setSplitRatio(
        splitRatioAt(point.clientX, stage, snapshot.mediaBox, snapshot.splitRatio),
      )
    })
  }

  const dispose = () => releaseActiveDrag()

  return {
    watchStage,
    prepareAssetSwitch,
    resetCompareView,
    fitInitialViewport,
    wheel,
    pointerDown,
    settleMediaSize,
    startSplitDrag,
    dispose,
  }
}
