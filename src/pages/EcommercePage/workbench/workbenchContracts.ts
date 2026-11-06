import { fitViewport as fitCanvasViewport, panBy, zoomAt } from '../../../domain/shared/geometry/transform'
import { createId } from '../../../shared/id'
import type { EcommerceCanvasItem } from '../../../domain/ecommerce/canvasItem'
import type {
  EcommerceResultRecord,
  EcommerceTaskRecord,
} from '../../../domain/ecommerce/tasks'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import {
  clamp,
  fromCanvasViewport,
  MIN_ITEM_SIZE,
  MIN_SCALE,
  MAX_SCALE,
  MINIMAP_PADDING,
  toCanvasViewport,
  type MinimapModel,
  type Point,
  type ResizeHandle,
  type Viewport,
} from '../workbenchGeometry'
import type { WorkbenchTool } from '../EcommerceWorkbenchViews'
import {
  marqueeSelectionIds,
  movedWorkbenchItems,
  nextWorkbenchObjectPosition,
  resizedWorkbenchItems,
  rotatedWorkbenchItems,
  selectedWorkbenchActions,
  workbenchBlankInteraction,
  workbenchMarqueeSelection,
  workbenchMoveInteraction,
  workbenchPointerBox,
  workbenchResizeInteraction,
  workbenchRotateInteraction,
  type WorkbenchAction,
  type WorkbenchInteraction,
  type WorkbenchRect,
} from './workbenchInteraction'

export type EcommerceWorkbenchAction = WorkbenchAction
export type {
  Point,
  ResizeHandle,
  Viewport,
  WorkbenchAction,
  WorkbenchInteraction,
  WorkbenchRect,
  WorkbenchTool,
}
export {
  MIN_SCALE,
  MAX_SCALE,
  MIN_ITEM_SIZE,
  MINIMAP_PADDING,
  clamp,
  fromCanvasViewport,
  marqueeSelectionIds,
  movedWorkbenchItems,
  nextWorkbenchObjectPosition,
  resizedWorkbenchItems,
  rotatedWorkbenchItems,
  selectedWorkbenchActions,
  toCanvasViewport,
  workbenchBlankInteraction,
  workbenchMarqueeSelection,
  workbenchMoveInteraction,
  workbenchPointerBox,
  workbenchResizeInteraction,
  workbenchRotateInteraction,
}

export interface EcommerceWorkbenchProps {
  projectId: string
  items: readonly EcommerceCanvasItem[]
  results: readonly EcommerceResultRecord[]
  tasks: readonly EcommerceTaskRecord[]
  runs?: readonly RunRecord[]
  activeResults?: readonly EcommerceResultRecord[]
  running?: boolean
  availableActions?: readonly EcommerceWorkbenchAction[]
  onItemsChange: (items: EcommerceCanvasItem[]) => void
  onCanvasUpload?: (file: File) => Promise<{ hash: string; width?: number; height?: number } | null>
  onAction?: (item: EcommerceCanvasItem, action: EcommerceWorkbenchAction) => void
  onRemoveFailed?: (resultId: string) => void
  channelLabelOf?: (channelId: string) => string
}

export interface WorkbenchUploadResult {
  hash: string
  width?: number
  height?: number
}

export interface WorkbenchRectLike {
  left: number
  top: number
  width: number
  height: number
}

export interface WorkbenchWheelEvent {
  clientX: number
  clientY: number
  deltaY: number
}

interface WorkbenchItemClock {
  createId(prefix: string): string
  now(): number
}

const defaultItemClock: WorkbenchItemClock = {
  createId,
  now: () => Date.now(),
}

function nextZIndex(items: readonly EcommerceCanvasItem[]): number {
  return Math.max(0, ...items.map((candidate) => candidate.zIndex)) + 1
}

export function fitWorkbenchItemsViewport(
  items: readonly EcommerceCanvasItem[],
  rect: WorkbenchRectLike,
  padding: number,
): Viewport {
  if (items.length === 0) return { x: 48, y: 48, scale: 1 }
  return fromCanvasViewport(fitCanvasViewport(
    items.map((item) => ({
      x: item.x,
      y: item.y,
      w: item.width,
      h: item.height,
    })),
    { x: 0, y: 0, w: rect.width, h: rect.height },
    padding,
  ))
}

export function panWorkbenchViewport(
  viewport: Viewport,
  dx: number,
  dy: number,
): Viewport {
  return fromCanvasViewport(panBy(toCanvasViewport(viewport), dx, dy))
}

export function wheelWorkbenchViewport(
  current: Viewport,
  event: WorkbenchWheelEvent,
  rect: WorkbenchRectLike,
): Viewport {
  const zoom = clamp(
    current.scale * Math.exp(-event.deltaY * 0.0015),
    MIN_SCALE,
    MAX_SCALE,
  )
  return fromCanvasViewport(zoomAt(
    toCanvasViewport(current),
    { x: event.clientX, y: event.clientY },
    { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
    zoom,
  ))
}

export function workbenchViewportFromMinimapPointer(input: {
  minimap: Pick<MinimapModel, 'bounds' | 'scale'>
  event: { clientX: number; clientY: number }
  rect: { left: number; top: number }
  size: { width: number; height: number }
  scale: number
}): Viewport {
  const worldX = input.minimap.bounds.minX +
    (input.event.clientX - input.rect.left - MINIMAP_PADDING) / input.minimap.scale
  const worldY = input.minimap.bounds.minY +
    (input.event.clientY - input.rect.top - MINIMAP_PADDING) / input.minimap.scale
  return fromCanvasViewport({
    x: worldX - input.size.width / (2 * input.scale),
    y: worldY - input.size.height / (2 * input.scale),
    zoom: input.scale,
  })
}

export function workbenchUploadedSize(uploaded: WorkbenchUploadResult): {
  width: number
  height: number
} {
  const width = 520
  const aspect = uploaded.width && uploaded.height ? uploaded.width / uploaded.height : 1
  return { width, height: Math.max(120, Math.round(width / aspect)) }
}

export function createWorkbenchTextItem(
  input: {
    projectId: string
    position: Point
    items: readonly EcommerceCanvasItem[]
  },
  clock: WorkbenchItemClock = defaultItemClock,
): EcommerceCanvasItem {
  return {
    id: clock.createId('eci'),
    projectId: input.projectId,
    kind: 'text',
    text: '输入文字',
    x: input.position.x,
    y: input.position.y,
    width: 280,
    height: 84,
    rotation: 0,
    zIndex: nextZIndex(input.items),
    aspectLocked: false,
    autoLayout: false,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  }
}

export function createWorkbenchUploadedItem(
  input: {
    projectId: string
    uploaded: WorkbenchUploadResult
    position: Point
    size: { width: number; height: number }
    items: readonly EcommerceCanvasItem[]
  },
  clock: WorkbenchItemClock = defaultItemClock,
): EcommerceCanvasItem {
  return {
    id: clock.createId('eci'),
    projectId: input.projectId,
    kind: 'image',
    assetHash: input.uploaded.hash,
    x: input.position.x,
    y: input.position.y,
    width: input.size.width,
    height: input.size.height,
    rotation: 0,
    zIndex: nextZIndex(input.items),
    aspectLocked: true,
    autoLayout: false,
    createdAt: clock.now(),
    updatedAt: clock.now(),
  }
}
