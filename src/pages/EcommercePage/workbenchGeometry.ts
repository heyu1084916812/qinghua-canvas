import type { EcommerceCanvasItem } from '../../domain/ecommerce/canvasItem'
import {
  screenToWorld as canvasScreenToWorld,
  type Viewport as CanvasViewport,
} from '../../domain/shared/geometry/coords'
import { fitViewport, panBy, zoomAt } from '../../domain/shared/geometry/transform'

export interface Viewport { x: number; y: number; scale: number }
export interface Point { x: number; y: number }
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4
export const MIN_ITEM_SIZE = 96
export const MINIMAP_WIDTH = 184
export const MINIMAP_HEIGHT = 112
export const MINIMAP_PADDING = 9

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export const toCanvasViewport = (viewport: Viewport): CanvasViewport => ({
  x: -viewport.x / viewport.scale,
  y: -viewport.y / viewport.scale,
  zoom: viewport.scale,
})

export const fromCanvasViewport = (viewport: CanvasViewport): Viewport => ({
  x: -viewport.x * viewport.zoom,
  y: -viewport.y * viewport.zoom,
  scale: viewport.zoom,
})

export const screenToWorkbenchWorld = (
  point: Point,
  viewport: Viewport,
  rect: DOMRect,
): Point => canvasScreenToWorld(point, toCanvasViewport(viewport), {
  x: rect.left,
  y: rect.top,
  w: rect.width,
  h: rect.height,
})

export const itemScreenRect = (item: EcommerceCanvasItem, viewport: Viewport) => ({
  left: viewport.x + item.x * viewport.scale,
  top: viewport.y + item.y * viewport.scale,
  width: item.width * viewport.scale,
  height: item.height * viewport.scale,
})

export interface MinimapModel {
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  scale: number
  items: {
    id: string
    left: number
    top: number
    width: number
    height: number
    selected: boolean
  }[]
  viewportRect: { left: number; top: number; width: number; height: number }
}

export function workbenchMinimapModel(
  items: readonly EcommerceCanvasItem[],
  selectedIds: ReadonlySet<string>,
  size: { width: number; height: number },
  viewport: Viewport,
): MinimapModel | null {
  if (size.width <= 0 || size.height <= 0) return null
  const view = {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width: size.width / viewport.scale,
    height: size.height / viewport.scale,
  }
  const bounds = items.reduce(
    (acc, item) => ({
      minX: Math.min(acc.minX, item.x),
      minY: Math.min(acc.minY, item.y),
      maxX: Math.max(acc.maxX, item.x + item.width),
      maxY: Math.max(acc.maxY, item.y + item.height),
    }),
    {
      minX: view.x,
      minY: view.y,
      maxX: view.x + view.width,
      maxY: view.y + view.height,
    },
  )
  const worldWidth = Math.max(1, bounds.maxX - bounds.minX)
  const worldHeight = Math.max(1, bounds.maxY - bounds.minY)
  const scale = Math.min(
    (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / worldWidth,
    (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / worldHeight,
  )
  return {
    bounds,
    scale,
    items: items.map((item) => ({
      id: item.id,
      left: MINIMAP_PADDING + (item.x - bounds.minX) * scale,
      top: MINIMAP_PADDING + (item.y - bounds.minY) * scale,
      width: Math.max(2, item.width * scale),
      height: Math.max(2, item.height * scale),
      selected: selectedIds.has(item.id),
    })),
    viewportRect: {
      left: MINIMAP_PADDING + (view.x - bounds.minX) * scale,
      top: MINIMAP_PADDING + (view.y - bounds.minY) * scale,
      width: view.width * scale,
      height: view.height * scale,
    },
  }
}

export const fitWorkbenchViewport = fitViewport
export const panWorkbenchViewport = panBy
export const zoomWorkbenchViewport = zoomAt
