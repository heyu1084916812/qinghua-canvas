import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Point } from '../../../domain/canvas/geometry/rect'
import {
  computeSnap,
  SNAP_THRESHOLD_SCREEN_PX,
  type SnapGap,
  type SnapGuide,
} from '../../../domain/canvas/layout/snap'
import {
  nodesIntersectingMarquee,
  topLevelNodes,
  type MarqueeRect,
} from './flowGraph'
import { isEditableKeyboardTarget } from './flowSurfaceMenus'
import {
  dropPointOf,
  resolveDropOutcome,
  type DropOutcome,
} from '../../../features/canvas/dropReparent'

export interface FlowNodeChangeLike {
  type: string
  id?: string
  selected?: boolean
  position?: { x: number; y: number }
}

export interface FlowEdgeChangeLike {
  type: string
  id?: string
  selected?: boolean
}

export interface FlowDragAnchor {
  clientX: number
  clientY: number
  zoom: number
  nodes: ReadonlyMap<string, { x: number; y: number }>
}

export interface FlowNodeMove {
  ids: string[]
  dx: number
  dy: number
}

export interface FlowSnapHints {
  guides: SnapGuide[]
  gaps: SnapGap[]
}

export interface NodeSelectionPlan {
  selection: string[]
  changed: boolean
}

export interface NodePositionPlan {
  move: FlowNodeMove | null
  snapHints: FlowSnapHints | null
  snapHintsChanged: boolean
}

export type EdgeSelectionPlan =
  | { kind: 'none' }
  | { kind: 'same' }
  | { kind: 'suppressed' }
  | { kind: 'apply'; ids: string[] }

export interface FlowDeletionPlan {
  edgeIds: string[]
  nodeIds: string[]
  clearSelection: boolean
  undoLabel: string | null
}

export interface FlowDeletePorts {
  removeEdge: (id: string) => void
  deleteNodes: (ids: readonly string[]) => void
  clearSelection: () => void
  showUndoBar: (message: string) => void
}

export interface FlowDragEndPlan {
  moves: FlowNodeMove[]
  snapMove: FlowNodeMove | null
  moved: boolean
}

export interface NodeClickSelectionPlan {
  selection: string[]
  changed: boolean
}

function snapForMove(
  graph: GraphSnapshot,
  ids: readonly string[],
  starts: ReadonlyMap<string, { x: number; y: number }>,
  raw: { dx: number; dy: number },
  zoom: number,
) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const moving = ids.flatMap((id) => {
    const start = starts.get(id)
    const node = byId.get(id)
    return start && node
      ? [{ x: start.x + raw.dx, y: start.y + raw.dy, w: node.w, h: node.h }]
      : []
  })
  const dragging = new Set(ids)
  const others = topLevelNodes(graph)
    .filter((node) => !dragging.has(node.id))
    .map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h }))
  return computeSnap({
    moving,
    others,
    threshold: SNAP_THRESHOLD_SCREEN_PX / (zoom || 1),
  })
}

/**
 * React Flow 的节点选择只以顶层节点为 baseline。框选新增还要再按真实图矩形过滤，
 * 避免选中框外节点；未命中的 change 不改变 selectionChanged。
 */
export function planNodeSelection(input: {
  graph: GraphSnapshot
  selection: readonly string[]
  changes: readonly FlowNodeChangeLike[]
  marquee: MarqueeRect | null
  baseline: readonly string[]
}): NodeSelectionPlan {
  const rfIds = new Set(topLevelNodes(input.graph).map((node) => node.id))
  const selected = new Set(input.selection.filter((id) => rfIds.has(id)))
  const insideMarquee = input.marquee
    ? new Set(nodesIntersectingMarquee(input.graph, input.marquee, input.baseline))
    : null
  let changed = false
  for (const change of input.changes) {
    if (change.type !== 'select' || !change.id) continue
    if (change.selected) {
      if (insideMarquee && !insideMarquee.has(change.id)) continue
      selected.add(change.id)
    } else {
      selected.delete(change.id)
    }
    changed = true
  }
  return { selection: [...selected], changed }
}

export function planChildNodeSelection(input: {
  selection: readonly string[]
  childId: string
  parentId: string
  shiftKey: boolean
}): NodeClickSelectionPlan {
  const kept = input.selection.filter((id) => id !== input.parentId)
  const selection = kept.includes(input.childId)
    ? kept
    : input.shiftKey
      ? [...kept, input.childId]
      : [input.childId]
  return {
    selection,
    changed:
      selection.length !== input.selection.length ||
      selection.some((id, index) => id !== input.selection[index]),
  }
}

/**
 * 位移以第一个 position change 和 store 当前快照计算增量，所有位置 id 一起下发。
 * 有拖动起点时用起点到当前的原始位移计算吸附，再把修正量并入本帧。
 */
export function planNodePositionChanges(input: {
  graph: GraphSnapshot
  changes: readonly FlowNodeChangeLike[]
  anchor: FlowDragAnchor | null
}): NodePositionPlan | null {
  const positions = input.changes
    .filter(
      (change): change is FlowNodeChangeLike & {
        id: string
        position: { x: number; y: number }
      } => change.type === 'position' && !!change.id && !!change.position,
    )
    .map((change) => ({ id: change.id, position: change.position }))
  if (positions.length === 0) return null

  const current = new Map(input.graph.nodes.map((node) => [node.id, node]))
  const ids = positions.map((change) => change.id)
  const first = positions[0]
  const base = current.get(first.id)
  if (!base) return null

  let dx = first.position.x - base.x
  let dy = first.position.y - base.y
  const anchor = input.anchor
  const start = anchor?.nodes.get(first.id)
  let snapHints: FlowSnapHints | null = null
  let snapHintsChanged = false
  if (anchor && start) {
    const snap = snapForMove(
      input.graph,
      ids,
      anchor.nodes,
      {
        dx: first.position.x - start.x,
        dy: first.position.y - start.y,
      },
      anchor.zoom,
    )
    dx += snap.dx
    dy += snap.dy
    snapHints = { guides: snap.guides, gaps: snap.gaps }
    snapHintsChanged = true
  }

  return {
    move: dx === 0 && dy === 0 ? null : { ids, dx, dy },
    snapHints,
    snapHintsChanged,
  }
}

export function dragIdsOf(fallbackId: string, draggedIds: readonly string[]): string[] {
  return draggedIds.length > 0 ? [...draggedIds] : [fallbackId]
}

/**
 * 松手时先按 pointerdown 锚点补最后一帧位移，再以同一锚点做一次终点吸附。
 * 半像素以内不补；有实际修正或吸附才把 moved 置真。宿主负责实际 dispatch。
 */
export function planFlowDragEnd(input: {
  graph: GraphSnapshot
  ids: readonly string[]
  moved: boolean
  anchor: FlowDragAnchor | null
  pointer: { clientX: number; clientY: number } | null
}): FlowDragEndPlan {
  let moved = input.moved
  const moves: FlowNodeMove[] = []
  let snapMove: FlowNodeMove | null = null
  const anchor = input.anchor
  if (anchor && input.pointer) {
    const movedX = (input.pointer.clientX - anchor.clientX) / (anchor.zoom || 1)
    const movedY = (input.pointer.clientY - anchor.clientY) / (anchor.zoom || 1)
    const current = new Map(input.graph.nodes.map((node) => [node.id, node]))
    for (const id of input.ids) {
      const from = anchor.nodes.get(id)
      const now = current.get(id)
      if (!from || !now) continue
      const dx = from.x + movedX - now.x
      const dy = from.y + movedY - now.y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      moved = true
      moves.push({ ids: [id], dx, dy })
    }

    const snap = snapForMove(
      input.graph,
      input.ids,
      anchor.nodes,
      { dx: movedX, dy: movedY },
      anchor.zoom,
    )
    if (snap.dx !== 0 || snap.dy !== 0) {
      moved = true
      snapMove = { ids: [...input.ids], dx: snap.dx, dy: snap.dy }
    }
  }
  return { moves, snapMove, moved }
}

export function planFlowDragDrop(input: {
  graph: GraphSnapshot
  ids: readonly string[]
  pointerWorld: Point | null
}): DropOutcome | { kind: 'skip' } {
  if (input.ids.length !== 1) return { kind: 'skip' }
  const node = input.graph.nodes.find((candidate) => candidate.id === input.ids[0])
  if (!node) return { kind: 'skip' }
  return resolveDropOutcome(
    node.id,
    dropPointOf(input.pointerWorld, node, input.graph),
    input.graph,
  )
}

/**
 * 边选择先去掉与当前完全相同的批次，再受同一帧节点选择戳抑制。
 * 两套判断的顺序不可交换，否则点线或框选节点都会被错误批次覆盖。
 */
export function planEdgeSelection(input: {
  current: readonly string[]
  changes: readonly FlowEdgeChangeLike[]
  nodeSelectStamp: boolean
}): EdgeSelectionPlan {
  const selected = new Set(input.current)
  let next: string[] | null = null
  for (const change of input.changes) {
    if (change.type !== 'select' || !change.id) continue
    if (change.selected) selected.add(change.id)
    else selected.delete(change.id)
    next = [...selected]
  }
  if (!next) return { kind: 'none' }
  const same =
    next.length === input.current.length &&
    next.every((id, index) => id === input.current[index])
  if (same) return { kind: 'same' }
  if (input.nodeSelectStamp) return { kind: 'suppressed' }
  return { kind: 'apply', ids: next }
}

export function planFlowDeletion(input: {
  nodeIds: readonly string[]
  edgeIds: readonly string[]
  clearSelection?: boolean
  undoLabel?: string
}): FlowDeletionPlan | null {
  const nodeIds = [...input.nodeIds]
  const edgeIds = [...input.edgeIds]
  if (nodeIds.length === 0 && edgeIds.length === 0) return null
  return {
    edgeIds,
    nodeIds,
    clearSelection: input.clearSelection === true,
    undoLabel:
      nodeIds.length > 0 ? (input.undoLabel ?? '已删除节点') : null,
  }
}

/**
 * Del / Backspace 的统一决策（用户第 16 批 #6）：
 * 容器子节点不是 RF 节点，不能依赖 React Flow 的 deleteKeyCode，否则选中子节点时无动作。
 * 这里只认有效按键和非文本输入焦点；输入框 / 文本域 / contenteditable 保留原生编辑行为。
 * 有选择时先删线、再删节点，并在宿主执行计划后清空节点选择与弹撤销条。
 */
export function planFlowDeleteKey(input: {
  key: string
  target: { tagName?: string; isContentEditable?: boolean } | null
  nodeIds: readonly string[]
  edgeIds: readonly string[]
}): FlowDeletionPlan | null {
  if (input.key !== 'Delete' && input.key !== 'Backspace') return null
  if (isEditableKeyboardTarget(input.target)) return null
  return planFlowDeletion({
    nodeIds: input.nodeIds,
    edgeIds: input.edgeIds,
    clearSelection: true,
  })
}

/**
 * 删除语义只在这里定序：清空 no-op；先逐条删线，再删节点，最后清选择和弹撤销条。
 * 宿主只提供 dispatch / selection / notify 端口。
 */
export function executeFlowDeletion(
  plan: FlowDeletionPlan | null,
  ports: FlowDeletePorts,
): void {
  if (!plan) return
  for (const id of plan.edgeIds) ports.removeEdge(id)
  if (plan.nodeIds.length === 0) return
  ports.deleteNodes(plan.nodeIds)
  if (plan.clearSelection) ports.clearSelection()
  if (plan.undoLabel) ports.showUndoBar(plan.undoLabel)
}

export function deleteFlowNodeIds(
  nodeIds: readonly string[],
  ports: FlowDeletePorts,
): void {
  executeFlowDeletion(planFlowDeletion({ nodeIds, edgeIds: [] }), ports)
}

export function deleteFlowEdgeIds(
  edgeIds: readonly string[],
  ports: FlowDeletePorts,
): void {
  executeFlowDeletion(planFlowDeletion({ nodeIds: [], edgeIds }), ports)
}
