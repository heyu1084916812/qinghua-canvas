import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { Size } from '../../../domain/canvas/geometry/rect'

export const NODE_VIEWPORT_CULL_MARGIN_PX = 320

export interface CullableNode {
  type: string
  parentId: string | null
  x: number
  y: number
  w: number
  h: number
}

/**
 * Only the common leaf nodes participate. Container and editor nodes may draw
 * outside their frame, so they keep the conservative content-visibility:auto path.
 */
export function shouldCullCanvasNode(node: Pick<CullableNode, 'type' | 'parentId'>): boolean {
  return !node.parentId && (node.type === 'prompt' || node.type === 'generation')
}

/**
 * Returns true only when the node is fully outside the padded world viewport.
 * Keeping a warm margin prevents visible-content pop while panning or zooming.
 */
export function nodeOutsideViewport(
  node: Pick<CullableNode, 'x' | 'y' | 'w' | 'h'>,
  viewport: Viewport,
  surface: Size | null,
  marginPx = NODE_VIEWPORT_CULL_MARGIN_PX,
): boolean {
  if (!surface || surface.w <= 0 || surface.h <= 0) return false
  const zoom = viewport.zoom || 1
  const margin = marginPx / zoom
  const left = viewport.x - margin
  const top = viewport.y - margin
  const right = viewport.x + surface.w / zoom + margin
  const bottom = viewport.y + surface.h / zoom + margin
  return node.x + node.w < left || node.x > right || node.y + node.h < top || node.y > bottom
}
