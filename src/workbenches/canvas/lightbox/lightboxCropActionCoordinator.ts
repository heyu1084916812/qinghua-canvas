import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import {
  FUSION_MIN_EDGE,
  clampRect,
  fitRectToRatio,
  movedCropRect,
  resizedCropRect,
  type CropHandle,
} from '../../../domain/canvas/fusion/fusionPlan'
import type { FusionRect } from '../../../domain/canvas/model/node'
import { faceBoxFromRect } from '../../../features/canvas/emotionEdit'
import type { FaceBox } from '../../../domain/canvas/vision/faceBox'
import { imagePointAt } from './lightboxViewportMath'
import { isPrimaryPointer } from './lightboxKeyboard'

export interface LightboxCropState {
  cropRect: FusionRect | null
  cropRatio: string
  ratioValue: number | null
  natural: { w: number; h: number } | null
  viewport: Viewport | null
  faceFor?: string
  cropFor?: string
  ownerNodeId: string
  plainCrop: boolean
}

export interface LightboxCropPointer {
  button: number
  clientX: number
  clientY: number
  stopPropagation(): void
  preventDefault(): void
}

export interface LightboxCropPointerDragHandlers {
  onMove(point: { clientX: number; clientY: number }): void
  onUp(): void
}

export interface LightboxCropRequest {
  nodeId: string
  rect: FusionRect
  ratio: string
}

export type LightboxCropOutcome =
  | { ok: true; nodeId: string }
  | { ok: false; reason: string }

export interface LightboxCropPorts {
  state(): LightboxCropState
  stageRect(): Rect | null
  setCropRect(rect: FusionRect): void
  setMoved(value: boolean): void
  setBusy(value: boolean): void
  notify(message: string, tone?: 'error'): void
  updateFaceBox(nodeId: string, box: FaceBox): void
  crop(input: LightboxCropRequest): Promise<LightboxCropOutcome>
  extract(input: LightboxCropRequest): Promise<LightboxCropOutcome>
  close(): void
  subscribePointerDrag(handlers: LightboxCropPointerDragHandlers): () => void
}

interface ActivePointerDrag {
  active: boolean
  release: () => void
}

export function createLightboxCropActions(ports: LightboxCropPorts) {
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

  const pointAt = (
    state: LightboxCropState,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null =>
    imagePointAt(clientX, clientY, state.natural, state.viewport, ports.stageRect())

  const lockCrop = (rect: FusionRect): FusionRect => {
    const state = ports.state()
    if (!state.natural) return rect
    const locked = state.ratioValue ? fitRectToRatio(rect, state.ratioValue) : rect
    return clampRect(locked, { w: state.natural.w, h: state.natural.h })
  }

  const startMove = (event: LightboxCropPointer) => {
    const state = ports.state()
    if (!state.cropRect || !state.natural || !isPrimaryPointer(event.button)) return
    event.stopPropagation()
    event.preventDefault()
    ports.setMoved(true)
    const base = state.cropRect
    const bounds = { w: state.natural.w, h: state.natural.h }
    const from = pointAt(state, event.clientX, event.clientY)
    if (!from) return
    beginPointerDrag((point) => {
      const current = pointAt(state, point.clientX, point.clientY)
      if (!current) return
      ports.setCropRect(
        movedCropRect(base, current.x - from.x, current.y - from.y, bounds),
      )
    })
  }

  const startCrop = (event: LightboxCropPointer) => {
    if (!isPrimaryPointer(event.button)) return
    const state = ports.state()
    const start = pointAt(state, event.clientX, event.clientY)
    if (!start) return
    event.stopPropagation()
    ports.setMoved(true)
    beginPointerDrag((point) => {
      const current = pointAt(state, point.clientX, point.clientY)
      if (!current) return
      const rect = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x),
        h: Math.abs(current.y - start.y),
      }
      const locked = state.ratioValue ? fitRectToRatio(rect, state.ratioValue) : rect
      ports.setCropRect(clampRect(locked, { w: state.natural!.w, h: state.natural!.h }))
    })
  }

  const startResize = (handle: CropHandle, event: LightboxCropPointer) => {
    const state = ports.state()
    if (!state.cropRect || !state.natural || !isPrimaryPointer(event.button)) return
    event.stopPropagation()
    event.preventDefault()
    ports.setMoved(true)
    const base = state.cropRect
    const bounds = { w: state.natural.w, h: state.natural.h }
    beginPointerDrag((point) => {
      const current = pointAt(state, point.clientX, point.clientY)
      if (!current) return
      ports.setCropRect(
        resizedCropRect({
          base,
          handle,
          pointer: current,
          bounds,
          ratio: state.ratioValue,
          minEdge: FUSION_MIN_EDGE,
        }),
      )
    })
  }

  const confirmCrop = async () => {
    const state = ports.state()
    if (!state.cropRect) return
    if (state.faceFor) {
      if (!state.natural) return
      const box = faceBoxFromRect(state.cropRect, state.natural)
      if (!box) {
        ports.notify('这个框太小了，重新拖一个大一点的', 'error')
        return
      }
      ports.updateFaceBox(state.faceFor, box)
      ports.close()
      ports.notify('已框好脸部：点「生成」开始')
      return
    }

    const targetNodeId = state.cropFor ?? state.ownerNodeId
    if (!targetNodeId) return
    ports.setBusy(true)
    const input = {
      nodeId: targetNodeId,
      rect: state.cropRect,
      ratio: state.cropRatio,
    }
    const outcome = state.plainCrop
      ? await ports.crop(input)
      : await ports.extract(input)
    ports.setBusy(false)
    if (outcome.ok) {
      ports.close()
      ports.notify(
        state.plainCrop
          ? '已裁剪：新图已生成在原图右侧（不带选区上下文）'
          : '已提取选区：局部图已生成在原图右侧，并带上上下文',
      )
    } else {
      ports.notify(outcome.reason, 'error')
    }
  }

  const dispose = () => releaseActiveDrag()

  return {
    lockCrop,
    startMove,
    startCrop,
    startResize,
    confirmCrop,
    dispose,
  }
}
