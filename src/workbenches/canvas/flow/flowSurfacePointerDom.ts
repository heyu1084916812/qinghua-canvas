import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { Point } from '../../../domain/canvas/geometry/rect'
import {
  pointerWorldPoint,
  type FlowPointerLike,
} from './flowSurfacePointer'

/** Keep native d3-drag away from gestures owned by another canvas tool. */
export function blockNativeNodeDrag(target: EventTarget | null): void {
  const frame =
    target instanceof Element
      ? target.closest<HTMLElement>('[data-node-id]')
      : null
  if (!frame) return
  const ensure = () => {
    if (!frame.classList.contains('nodrag')) frame.classList.add('nodrag')
  }
  ensure()
  const observer = new MutationObserver(ensure)
  observer.observe(frame, { attributes: true, attributeFilter: ['class'] })
  const cleanup = () => {
    observer.disconnect()
    frame.classList.remove('nodrag')
    window.removeEventListener('pointerup', cleanup)
    window.removeEventListener('pointercancel', cleanup)
  }
  window.addEventListener('pointerup', cleanup)
  window.addEventListener('pointercancel', cleanup)
}

/** Pointer screen coordinates -> canvas world coordinates. */
export function pointerWorldPointDom(
  ev: FlowPointerLike | null | undefined,
  store: CanvasStore,
): Point | null {
  const element = document.querySelector<HTMLElement>('[data-canvas-surface]')
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return pointerWorldPoint(ev, store.getViewport(), {
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
  })
}
