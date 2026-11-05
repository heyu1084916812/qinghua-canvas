/** FlowSurface 的指针 / 框选几何：纯计算与豁免名单，不挂事件。 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Point } from '../../../domain/canvas/geometry/rect'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import type { MarqueeRect } from './flowGraph'

export const FLOATING_SELECTORS = [
  '[data-creation-panel]',
  '[data-emotion-panel]',
  '[data-node-follow-bar]',
  '[data-multi-select-bar]',
  '[data-context-menu]',
  '[data-link-menu]',
  '[data-canvas-notice]',
  '[data-undo-bar]',
  '[data-lightbox]',
  '[data-minimap]',
  '[data-flow-hud]',
  '[data-canvas-toolbar]',
  '[data-edge]',
  '.react-flow__edge',
  '.react-flow__handle',
  '[data-flow-port-hit]',
  '[data-empty-canvas-guide]',
].join(', ')

export const CLICK_SLOP_PX = 4

export type FlowPointerLike =
  | { clientX?: unknown; clientY?: unknown }
  | MouseEvent
  | TouchEvent
  | ReactPointerEvent

export function pointerWorldPoint(
  ev: FlowPointerLike | null | undefined,
  viewport: { x: number; y: number; zoom: number },
  surface: { x: number; y: number; w: number; h: number },
): Point | null {
  if (!ev || !('clientX' in ev) || !('clientY' in ev)) return null
  const { clientX, clientY } = ev as { clientX: unknown; clientY: unknown }
  if (typeof clientX !== 'number' || typeof clientY !== 'number') return null
  return screenToWorld({ x: clientX, y: clientY }, viewport, surface)
}

export function marqueeBetween(start: Point, point: Point): MarqueeRect {
  return { x: start.x, y: start.y, w: point.x - start.x, h: point.y - start.y }
}

export function isClickAfterDrag(
  press: Point | null | undefined,
  release: Point,
  slop = CLICK_SLOP_PX,
): boolean {
  return !!press && Math.hypot(release.x - press.x, release.y - press.y) > slop
}

export function dragAnchorOf(
  ids: readonly string[],
  rects: Map<string, { x: number; y: number }>,
  surface: { left: number; top: number },
  viewport: { x: number; y: number; zoom: number },
): Map<string, { x: number; y: number }> {
  const zoom = viewport.zoom || 1
  const nodes = new Map<string, { x: number; y: number }>()
  for (const id of ids) {
    const rect = rects.get(id)
    if (!rect) continue
    nodes.set(id, {
      x: (rect.x - surface.left) / zoom + viewport.x,
      y: (rect.y - surface.top) / zoom + viewport.y,
    })
  }
  return nodes
}
