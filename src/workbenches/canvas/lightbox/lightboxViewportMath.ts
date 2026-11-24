/** 灯箱缩放 / 平移与屏幕几何：复用画布 transform 的纯函数入口。 */
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { fitViewport, panBy, zoomAt } from '../../../domain/canvas/geometry/transform'

export const FIT_PADDING = 112
export const WHEEL_STEP = 1.12
export const DRAG_SLOP = 3

export interface MediaBox {
  left: number
  top: number
  width: number
  height: number
}

export function wheelZoom(viewport: Viewport, deltaY: number, clientX: number, clientY: number, stage: Rect): Viewport {
  const factor = deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
  return zoomAt(viewport, { x: clientX, y: clientY }, stage, viewport.zoom * factor)
}

export function dragPan(viewport: Viewport, dx: number, dy: number): Viewport {
  return panBy(viewport, dx, dy)
}

export function fitMediaViewport(natural: { w: number; h: number }, stage: Rect): Viewport {
  return fitViewport([{ x: 0, y: 0, w: natural.w, h: natural.h }], stage, FIT_PADDING)
}

/** Untouched frames fit independently; manually adjusted frames keep zoom and center. */
export function gallerySwitchViewport(
  previous: { w: number; h: number } | null,
  next: { w: number; h: number },
  viewport: Viewport | null,
  stage: Rect | null,
): Viewport | null {
  if (!viewport) return stage ? fitMediaViewport(next, stage) : null
  if (!previous) return null
  if (stage) {
    const previousFit = fitMediaViewport(previous, stage)
    const untouched =
      Math.abs(viewport.x - previousFit.x) <= 0.001 &&
      Math.abs(viewport.y - previousFit.y) <= 0.001 &&
      Math.abs(viewport.zoom - previousFit.zoom) <= 0.001
    if (untouched) return fitMediaViewport(next, stage)
  }
  const dx = (next.w - previous.w) / 2
  const dy = (next.h - previous.h) / 2
  if (Math.abs(dx) <= 0.001 && Math.abs(dy) <= 0.001) return null
  return { x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }
}

export function mediaBoxOf(natural: { w: number; h: number }, viewport: Viewport): MediaBox {
  return {
    left: -viewport.x * viewport.zoom,
    top: -viewport.y * viewport.zoom,
    width: natural.w * viewport.zoom,
    height: natural.h * viewport.zoom,
  }
}

export function predictedMediaRect(
  stage: HTMLElement | null,
  natural: { w: number; h: number } | null | undefined,
): Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | null {
  if (!stage || !natural || natural.w <= 0 || natural.h <= 0) return null
  const stageRect = stage.getBoundingClientRect()
  if (stageRect.width <= 0 || stageRect.height <= 0) return null
  const viewport = fitMediaViewport(natural, { x: 0, y: 0, w: stageRect.width, h: stageRect.height })
  const box = mediaBoxOf(natural, viewport)
  return {
    left: stageRect.left + box.left,
    top: stageRect.top + box.top,
    width: box.width,
    height: box.height,
  }
}

export function imagePointAt(
  clientX: number,
  clientY: number,
  natural: { w: number; h: number } | null,
  viewport: Viewport | null,
  stage: Rect | null,
): { x: number; y: number } | null {
  if (!natural || !viewport || !stage) return null
  const point = screenToWorld({ x: clientX, y: clientY }, viewport, stage)
  return {
    x: Math.max(0, Math.min(natural.w, point.x)),
    y: Math.max(0, Math.min(natural.h, point.y)),
  }
}

export function cropBoxOf(
  cropRect: { x: number; y: number; w: number; h: number } | null,
  viewport: Viewport | null,
): MediaBox | undefined {
  if (!cropRect || !viewport) return undefined
  return {
    left: -viewport.x * viewport.zoom + cropRect.x * viewport.zoom,
    top: -viewport.y * viewport.zoom + cropRect.y * viewport.zoom,
    width: cropRect.w * viewport.zoom,
    height: cropRect.h * viewport.zoom,
  }
}
