import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Point } from '../../../domain/canvas/geometry/rect'
import type { ContextMenuPoint } from './flowSurfaceMenus'
import {
  contextMenuPoint,
  shouldSelectNodeForMenu,
} from './flowSurfaceMenus'
import { importFeedback } from './flowSurfaceImport'
import {
  dragAnchorOf,
  isClickAfterDrag,
} from './flowSurfacePointer'
import {
  planChildNodeSelection,
  type FlowDragAnchor,
} from './flowSurfaceChangeCoordinator'
import { topLevelNodes } from './flowGraph'

export type SurfaceClickPlan =
  | { kind: 'none' }
  | { kind: 'clear'; selection: [] }
  | { kind: 'select'; selection: string[] }

export function planSurfaceClick(input: {
  press: Point | null
  release: Point
  nodeId: string | null
  parentId: string | null
  floatingTarget: boolean
  selection: readonly string[]
  shiftKey: boolean
}): SurfaceClickPlan {
  if (isClickAfterDrag(input.press, input.release)) return { kind: 'none' }
  if (!input.nodeId) {
    if (input.floatingTarget || input.selection.length === 0) return { kind: 'none' }
    return { kind: 'clear', selection: [] }
  }
  if (!input.parentId) return { kind: 'none' }
  const plan = planChildNodeSelection({
    selection: [...input.selection],
    childId: input.nodeId,
    parentId: input.parentId,
    shiftKey: input.shiftKey,
  })
  return plan.changed ? { kind: 'select', selection: plan.selection } : { kind: 'none' }
}

export interface ChildPointerPlan {
  selection: string[] | null
  reparent: { parentId: string; at: Point } | null
  beginDrag: boolean
}

export function planChildPointerDown(input: {
  selection: readonly string[]
  childId: string
  shiftKey: boolean
  batchSlot: { parentId: string; at: Point } | null
}): ChildPointerPlan {
  if (input.shiftKey) {
    return {
      selection: input.selection.includes(input.childId)
        ? input.selection.filter((id) => id !== input.childId)
        : [...input.selection, input.childId],
      reparent: null,
      beginDrag: false,
    }
  }
  const selection =
    input.selection.length > 1 && input.selection.includes(input.childId)
      ? null
      : [input.childId]
  return { selection, reparent: input.batchSlot, beginDrag: true }
}

export type SurfacePointerDownPlan =
  | { kind: 'pan' }
  | { kind: 'none'; dismissPanel: boolean }
  | { kind: 'duplicate'; nodeId: string; dismissPanel: true }
  | {
      kind: 'anchor'
      anchor: FlowDragAnchor
      dismissPanel: true
    }

export function planSurfacePointerDown(input: {
  button: number
  spaceHeld: boolean
  altKey: boolean
  nodeId: string | null
  selection: readonly string[]
  graph: GraphSnapshot
  viewport: { x: number; y: number; zoom: number }
  surface: { left: number; top: number; width: number; height: number }
  nodeRects: () => Map<string, Point>
  clientX: number
  clientY: number
}): SurfacePointerDownPlan {
  if (input.button === 0 && input.spaceHeld) return { kind: 'pan' }
  if (!input.nodeId) return { kind: 'none', dismissPanel: false }

  const topLevelIds = new Set(topLevelNodes(input.graph).map((node) => node.id))
  if (!topLevelIds.has(input.nodeId)) {
    return { kind: 'none', dismissPanel: true }
  }
  if (input.altKey) {
    return { kind: 'duplicate', nodeId: input.nodeId, dismissPanel: true }
  }

  const selected = input.selection.filter((id) => topLevelIds.has(id))
  const ids =
    selected.length > 1 && selected.includes(input.nodeId)
      ? selected
      : [input.nodeId]
  const anchor = dragAnchorOf(
    ids,
    input.nodeRects(),
    input.surface,
    input.viewport,
  )
  return {
    kind: 'anchor',
    anchor: {
      clientX: input.clientX,
      clientY: input.clientY,
      zoom: input.viewport.zoom || 1,
      nodes: anchor,
    },
    dismissPanel: true,
  }
}

export interface ContextMenuPlan {
  menu: ContextMenuPoint
  selection: string[] | null
}

export function planSurfaceContextMenu(input: {
  clientX: number
  clientY: number
  surface: { left: number; top: number }
  nodeId: string | null
  selection: readonly string[]
}): ContextMenuPlan {
  const menu = contextMenuPoint(
    input.clientX,
    input.clientY,
    { x: input.surface.left, y: input.surface.top },
    input.nodeId,
  )
  return {
    menu,
    selection:
      menu.target.kind === 'node' &&
      shouldSelectNodeForMenu(input.selection, menu.target.nodeId)
        ? [menu.target.nodeId]
        : null,
  }
}

export interface ImportedSurfaceFiles {
  ids: readonly string[]
  rejected: number
}

export interface FlowImportPorts {
  importFiles: (
    files: readonly File[],
    world: Point,
  ) => Promise<ImportedSurfaceFiles>
  select: (ids: string[]) => void
  notify: (message: string, tone: 'error') => void
  showUndoBar: (message: string) => void
}

export async function importSurfaceFiles(
  files: readonly File[],
  world: Point,
  ports: FlowImportPorts,
): Promise<void> {
  const { ids, rejected } = await ports.importFiles(files, world)
  const feedback = importFeedback(ids.length, rejected)
  if (rejected > 0 && feedback) ports.notify(feedback, 'error')
  if (ids.length === 0) return
  ports.select([...ids])
  if (feedback) ports.showUndoBar(feedback)
}
