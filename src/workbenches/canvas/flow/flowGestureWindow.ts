import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { Size } from '../../../domain/canvas/geometry/rect'

/**
 * A generous screen-space window keeps a normal pan from crossing the edge and
 * forcing nodes to mount mid-gesture. The window is computed once on pointer
 * down; nodes inside it stay mounted while the viewport moves.
 */
export const PAN_NODE_WINDOW_MARGIN_PX = 1000

export interface PositionedFlowNode {
  position: { x: number; y: number }
  width?: number
  height?: number
}

export function nodesInGestureWindow<T extends PositionedFlowNode>(
  nodes: readonly T[],
  viewport: Viewport,
  surface: Size | null,
  marginPx = PAN_NODE_WINDOW_MARGIN_PX,
): T[] {
  if (!surface || surface.w <= 0 || surface.h <= 0) return [...nodes]
  const zoom = viewport.zoom || 1
  const margin = marginPx / zoom
  const left = viewport.x - margin
  const top = viewport.y - margin
  const right = viewport.x + surface.w / zoom + margin
  const bottom = viewport.y + surface.h / zoom + margin

  return nodes.filter((node) => {
    const width = node.width ?? 0
    const height = node.height ?? 0
    return !(
      node.position.x + width < left ||
      node.position.x > right ||
      node.position.y + height < top ||
      node.position.y > bottom
    )
  })
}
