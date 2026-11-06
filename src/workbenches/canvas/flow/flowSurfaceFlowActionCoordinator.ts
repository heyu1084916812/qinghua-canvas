import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Point } from '../../../domain/canvas/geometry/rect'
import type { NodeViewEvent } from '../nodes/registry'
import type { FlowSnapHints } from './flowSurfaceChangeCoordinator'
import {
  dragIdsOf,
  executeFlowDeletion,
  planEdgeSelection,
  planFlowDeleteKey,
  planFlowDragDrop,
  planFlowDragEnd,
  planNodePositionChanges,
  planNodeSelection,
  type FlowDeletePorts,
  type FlowDragAnchor,
  type FlowEdgeChangeLike,
  type FlowNodeChangeLike,
} from './flowSurfaceChangeCoordinator'
import { nodesIntersectingMarquee, type MarqueeRect } from './flowGraph'
import {
  shouldRouteCancel,
  shouldRouteRun,
} from './flowSurfaceMenus'

export interface FlowNodeChangePorts {
  setSelection: (ids: string[]) => void
  stampNodeSelection: () => void
  setSnapHints: (hints: FlowSnapHints | null) => void
  markDragMoved: (moved: boolean) => void
  moveNodes: (
    ids: string[],
    dx: number,
    dy: number,
    phase: 'begin' | 'move' | 'end',
  ) => void
}

export function applyFlowNodeChanges(
  input: {
    graph: GraphSnapshot
    selection: readonly string[]
    changes: readonly FlowNodeChangeLike[]
    marquee: MarqueeRect | null
    baseline: readonly string[]
    anchor: FlowDragAnchor | null
  },
  ports: FlowNodeChangePorts,
): void {
  const selectionPlan = planNodeSelection(input)
  if (selectionPlan.changed) {
    ports.setSelection(selectionPlan.selection)
    ports.stampNodeSelection()
  }
  const positionPlan = planNodePositionChanges(input)
  if (!positionPlan) return
  if (positionPlan.snapHintsChanged) ports.setSnapHints(positionPlan.snapHints)
  if (!positionPlan.move) return
  ports.markDragMoved(true)
  ports.moveNodes(
    positionPlan.move.ids,
    positionPlan.move.dx,
    positionPlan.move.dy,
    'move',
  )
}

export interface FlowNodeDragStartPorts {
  setDragging: (active: boolean, nodeId: string | null) => void
  markDragMoved: (moved: boolean) => void
  moveNodes: (
    ids: string[],
    dx: number,
    dy: number,
    phase: 'begin' | 'move' | 'end',
  ) => void
}

export function beginFlowNodeDrag(
  input: { mainId: string; draggedIds: readonly string[] },
  ports: FlowNodeDragStartPorts,
): void {
  const ids = dragIdsOf(input.mainId, input.draggedIds)
  ports.markDragMoved(false)
  ports.setDragging(true, ids[0] ?? null)
  ports.moveNodes(ids, 0, 0, 'begin')
}

export interface FlowNodeDragEndInput {
  mainId: string
  draggedIds: readonly string[]
  moved: boolean
  anchor: FlowDragAnchor | null
  pointer: { clientX: number; clientY: number } | null
  pointerWorld: () => Point | null
}

export interface FlowNodeDragEndPorts {
  getSnapshot: () => GraphSnapshot
  resetDragTracking: () => void
  moveNodes: (
    ids: string[],
    dx: number,
    dy: number,
    phase: 'begin' | 'move' | 'end',
  ) => void
  setDragging: (active: boolean, nodeId: string | null) => void
  setSnapHints: (hints: FlowSnapHints | null) => void
  setPanelDismissed: (dismissed: boolean) => void
  notify: (message: string, tone: 'error') => void
  reparent: (id: string, parentId: string | null, at: Point | undefined) => void
}

export function finishFlowNodeDrag(
  input: FlowNodeDragEndInput,
  ports: FlowNodeDragEndPorts,
): void {
  const ids = dragIdsOf(input.mainId, input.draggedIds)
  const plan = planFlowDragEnd({
    graph: ports.getSnapshot(),
    ids,
    moved: input.moved,
    anchor: input.anchor,
    pointer: input.pointer,
  })
  ports.resetDragTracking()
  for (const move of plan.moves) {
    ports.moveNodes(move.ids, move.dx, move.dy, 'move')
  }
  if (plan.snapMove) {
    ports.moveNodes(
      plan.snapMove.ids,
      plan.snapMove.dx,
      plan.snapMove.dy,
      'move',
    )
  }
  ports.moveNodes(ids, 0, 0, 'end')
  ports.setDragging(false, null)
  ports.setSnapHints(null)
  if (plan.moved) ports.setPanelDismissed(true)

  const outcome = planFlowDragDrop({
    graph: ports.getSnapshot(),
    ids,
    pointerWorld: input.pointerWorld(),
  })
  if (outcome.kind === 'rejected') {
    ports.notify(outcome.reason, 'error')
    return
  }
  if (outcome.kind === 'ok') {
    const id = ids[0]
    if (id) ports.reparent(id, outcome.drop.toParent, outcome.drop.at)
  }
}

export interface FlowEdgeChangePorts {
  getEdgeSelection: () => readonly string[]
  setEdgeSelection: (ids: string[]) => void
}

export interface FlowSurfaceActionPorts
  extends FlowNodeChangePorts,
    FlowNodeDragEndPorts,
    FlowEdgeChangePorts {}

export function applyFlowEdgeChanges(
  input: {
    changes: readonly FlowEdgeChangeLike[]
    nodeSelectStamp: boolean
  },
  ports: FlowEdgeChangePorts,
): void {
  const plan = planEdgeSelection({
    current: ports.getEdgeSelection(),
    changes: input.changes,
    nodeSelectStamp: input.nodeSelectStamp,
  })
  if (plan.kind === 'apply') ports.setEdgeSelection(plan.ids)
}

export function routeFlowNodeEvent(
  nodeId: string,
  event: NodeViewEvent,
  ports: {
    run: (nodeId: string) => void
    cancel: (nodeId: string) => void
    emit: (nodeId: string, event: NodeViewEvent) => void
  },
): void {
  if (shouldRouteRun(event)) {
    ports.run(nodeId)
    return
  }
  if (shouldRouteCancel(event)) ports.cancel(nodeId)
  else ports.emit(nodeId, event)
}

export function applyFlowDeleteKey(
  input: {
    key: string
    target: { tagName?: string; isContentEditable?: boolean } | null
    nodeIds: readonly string[]
    edgeIds: readonly string[]
  },
  ports: FlowDeletePorts,
): boolean {
  const plan = planFlowDeleteKey(input)
  if (!plan) return false
  executeFlowDeletion(plan, ports)
  return true
}

export function beginSelectionMarquee(input: {
  point: Point
  selection: readonly string[]
  shiftKey: boolean
}): { start: Point; baseline: string[]; marquee: MarqueeRect } {
  return {
    start: input.point,
    baseline: input.shiftKey ? [...input.selection] : [],
    marquee: { x: input.point.x, y: input.point.y, w: 0, h: 0 },
  }
}

export function selectionFromMarquee(input: {
  graph: GraphSnapshot
  marquee: MarqueeRect
  baseline: readonly string[]
}): string[] {
  return nodesIntersectingMarquee(input.graph, input.marquee, input.baseline)
}

export interface FlowMeasurementPorts {
  requestFrame: (callback: () => void) => number
  cancelFrame: (id: number) => void
  schedule: (callback: () => void, delayMs: number) => number
  cancelSchedule: (id: number) => void
  updateNodeInternals: (ids: string[]) => void
}

export function scheduleFlowNodeMeasurement(
  graph: GraphSnapshot,
  ports: FlowMeasurementPorts,
): () => void {
  const ids = graph.nodes.map((node) => node.id)
  if (ids.length === 0) return () => {}
  const frames: number[] = []
  let timer: number | undefined
  frames.push(
    ports.requestFrame(() => {
      frames.push(
        ports.requestFrame(() => {
          timer = ports.schedule(() => ports.updateNodeInternals(ids), 120)
        }),
      )
    }),
  )
  return () => {
    for (const frame of frames) ports.cancelFrame(frame)
    if (timer !== undefined) ports.cancelSchedule(timer)
  }
}

export function flowNodeIdsOf(nodes: readonly { id: string }[]): string[] {
  return nodes.map((node) => node.id)
}

export function flowEdgeIdsOf(edges: readonly { id: string }[]): string[] {
  return edges.map((edge) => edge.id)
}
