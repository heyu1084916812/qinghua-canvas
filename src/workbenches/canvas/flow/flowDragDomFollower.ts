import { getBezierPath, Position } from '@xyflow/react'
import { toScreenPath } from './childEdges'

export interface FlowNodeDragStart {
  id: string
  x: number
  y: number
}

export interface FlowDragNodeHost {
  querySelector(selector: string): { style: { transform: string } } | null
}

interface PathTarget {
  element: Element
  d: string
}

/**
 * One edge followed during a direct drag. `scale` is 1 for React Flow edges
 * (world coordinates) and the zoom for container child edges (screen coordinates).
 */
export interface FlowDragEdgePathSnapshot {
  edgeId?: string
  childEdge?: boolean
  source: string
  target: string
  sourcePosition: Position
  targetPosition: Position
  scale: number
  paths: PathTarget[]
  deleteButton: { element: Element; transform: string } | null
}

/** Header labels and port hit blocks live in world-space layers: CSS `translate` stacks on their own transform. */
export interface FlowDragFollowers {
  layers: HTMLElement[]
  multiSelect: HTMLElement | null
  childEdges: FlowDragEdgePathSnapshot[]
}

const BEZIER_PATH =
  /^M\s*([^,\s]+),([^\s]+)\s+C\s*([^,\s]+),([^\s]+)\s+([^,\s]+),([^\s]+)\s+([^,\s]+),([^\s]+)$/i

const esc = (value: string) => value.replace(/["\\]/g, '\\$&')

function positionOf(value: string | null, fallback: Position): Position {
  return value === Position.Left || value === Position.Right ? value : fallback
}

export function writeFlowNodeDragDomPositions(
  host: FlowDragNodeHost,
  starts: readonly FlowNodeDragStart[],
  dx: number,
  dy: number,
): number {
  let written = 0
  for (const start of starts) {
    const element = host.querySelector(`.react-flow__node[data-id="${esc(start.id)}"]`)
    if (!element) continue
    element.style.transform = `translate(${start.x + dx}px, ${start.y + dy}px)`
    written += 1
  }
  return written
}

/**
 * Re-solves the edge with React Flow's own `getBezierPath` from the moved
 * endpoints, so the curve mid-drag is the one RF commits on release (no snap).
 * `dx/dy` are world units; `scale` maps the path's units to world units.
 */
export function rebuildFlowEdgePath(
  path: string,
  moveSource: boolean,
  moveTarget: boolean,
  dx: number,
  dy: number,
  options: { scale?: number; sourcePosition?: Position; targetPosition?: Position } = {},
): { path: string; midX: number; midY: number } | null {
  const match = BEZIER_PATH.exec(path)
  if (!match) return null
  const v = match.slice(1).map(Number)
  if (v.some((value) => !Number.isFinite(value))) return null
  const scale = options.scale || 1
  const [d, midX, midY] = getBezierPath({
    sourceX: v[0]! / scale + (moveSource ? dx : 0),
    sourceY: v[1]! / scale + (moveSource ? dy : 0),
    sourcePosition: options.sourcePosition ?? Position.Right,
    targetX: v[6]! / scale + (moveTarget ? dx : 0),
    targetY: v[7]! / scale + (moveTarget ? dy : 0),
    targetPosition: options.targetPosition ?? Position.Left,
  })
  if (scale === 1) return { path: d, midX, midY }
  return { path: toScreenPath(d, { x: 0, y: 0 }, scale), midX: midX * scale, midY: midY * scale }
}

function snapshotOf(
  visual: Element,
  group: Element | null,
  scale: number,
  edgeId?: string,
  childEdge = false,
): FlowDragEdgePathSnapshot | null {
  const source = visual.getAttribute('data-edge-source')
  const target = visual.getAttribute('data-edge-target')
  if (!source || !target) return null
  // Only the visible stroke and its hit path: never the delete button's cross.
  const candidates = group
    ? Array.from(group.querySelectorAll('path[data-edge], path[data-edge-hit]'))
    : [visual]
  const paths = candidates.flatMap((element) => {
    const d = element.getAttribute('d')
    return d ? [{ element, d }] : []
  })
  const deleteEl = group?.querySelector('[data-edge-delete]') ?? null
  return {
    edgeId,
    childEdge,
    source,
    target,
    sourcePosition: positionOf(visual.getAttribute('data-edge-source-position'), Position.Right),
    targetPosition: positionOf(visual.getAttribute('data-edge-target-position'), Position.Left),
    scale,
    paths,
    deleteButton: deleteEl ? { element: deleteEl, transform: deleteEl.getAttribute('transform') ?? '' } : null,
  }
}

export function captureFlowDragEdgePaths(
  host: ParentNode,
  movingIds: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>,
): FlowDragEdgePathSnapshot[] {
  const out: FlowDragEdgePathSnapshot[] = []
  for (const id of edgeIds) {
    const visual = host.querySelector(`.react-flow__edge [data-edge="${esc(id)}"]:not([data-child-edge])`)
    if (!visual) continue
    const snapshot = snapshotOf(visual, visual.closest('.react-flow__edge'), 1, id)
    if (snapshot && (movingIds.has(snapshot.source) || movingIds.has(snapshot.target))) out.push(snapshot)
  }
  return out
}

export function captureFlowDragFollowers(
  host: ParentNode,
  affectedIds: ReadonlySet<string>,
  zoom: number,
): FlowDragFollowers {
  const layers: HTMLElement[] = []
  for (const id of affectedIds) {
    layers.push(...Array.from(host.querySelectorAll<HTMLElement>(`[data-flow-node-header="${esc(id)}"]`)))
    layers.push(...Array.from(host.querySelectorAll<HTMLElement>(`[data-flow-port-hit^="${esc(id)}:"]`)))
  }
  const childEdges = Array.from(host.querySelectorAll('path[data-child-edge][data-edge-source]')).flatMap((visual) => {
    const id = visual.getAttribute('data-child-edge') ?? ''
    const snapshot = snapshotOf(visual, null, zoom || 1, id, true)
    if (!snapshot || (!affectedIds.has(snapshot.source) && !affectedIds.has(snapshot.target))) return []
    for (const hit of Array.from(host.querySelectorAll(`[data-child-edge-hit="${esc(id)}"]`))) {
      const d = hit.getAttribute('d')
      if (d) snapshot.paths.push({ element: hit, d })
    }
    return [snapshot]
  })
  return {
    layers,
    multiSelect: host.querySelector<HTMLElement>('[data-multi-select]'),
    childEdges,
  }
}

function currentPathsOf(s: FlowDragEdgePathSnapshot): PathTarget[] {
  if (!s.edgeId || typeof document === 'undefined') return s.paths
  if (s.paths.every((path) => path.element.isConnected)) return s.paths
  if (s.childEdge) {
    const visual = document.querySelector(`path[data-child-edge="${esc(s.edgeId)}"][data-edge-source]`)
    if (!visual) return s.paths
    const out = [{ element: visual, d: visual.getAttribute('d') ?? '' }]
    for (const hit of Array.from(document.querySelectorAll(`[data-child-edge-hit="${esc(s.edgeId)}"]`))) {
      out.push({ element: hit, d: hit.getAttribute('d') ?? '' })
    }
    return out
  }
  const visual = document.querySelector(
    `.react-flow__edge [data-edge="${esc(s.edgeId)}"]:not([data-child-edge])`,
  )
  const group = visual?.closest('.react-flow__edge') ?? null
  if (!visual || !group) return s.paths
  return Array.from(group.querySelectorAll('path[data-edge], path[data-edge-hit]')).map((element) => ({
    element,
    d: element.getAttribute('d') ?? '',
  }))
}

function currentDeleteOf(s: FlowDragEdgePathSnapshot) {
  if (!s.edgeId || s.childEdge || typeof document === 'undefined') return s.deleteButton
  const visual = document.querySelector(
    `.react-flow__edge [data-edge="${esc(s.edgeId)}"]:not([data-child-edge])`,
  )
  const element = visual?.closest('.react-flow__edge')?.querySelector('[data-edge-delete]')
  if (!element) return s.deleteButton
  return { element, transform: element.getAttribute('transform') ?? '' }
}

export function writeFlowDragEdgePaths(
  snapshots: readonly FlowDragEdgePathSnapshot[],
  movingIds: ReadonlySet<string>,
  dx: number,
  dy: number,
): number {
  let written = 0
  for (const s of snapshots) {
    const paths = currentPathsOf(s)
    const next = rebuildFlowEdgePath(paths[0]?.d ?? '', movingIds.has(s.source), movingIds.has(s.target), dx, dy, s)
    if (!next) continue
    for (const path of paths) path.element.setAttribute('d', next.path)
    s.paths = paths
    const deleteButton = currentDeleteOf(s)
    if (deleteButton) {
      const base = deleteButton.transform
      const translate = `translate(${next.midX}, ${next.midY})`
      deleteButton.element.setAttribute(
        'transform',
        /translate\([^)]*\)/.test(base)
          ? base.replace(/translate\([^)]*\)/, translate)
          : translate,
      )
      s.deleteButton = deleteButton
    }
    written += 1
  }
  return written
}

export function writeFlowDragFollowers(
  f: FlowDragFollowers,
  affectedIds: ReadonlySet<string>,
  dx: number,
  dy: number,
  screenDx = dx,
  screenDy = dy,
) {
  const value = `${dx}px ${dy}px`
  for (const el of f.layers) el.style.translate = value
  if (f.multiSelect) f.multiSelect.style.translate = `${screenDx}px ${screenDy}px`
  writeFlowDragEdgePaths(f.childEdges, affectedIds, dx, dy)
}

/** `restorePaths`: put captured `d`s back when no new graph committed (React would not rewrite an unchanged prop). */
export function clearFlowDragFollowers(
  f: FlowDragFollowers,
  edges: readonly FlowDragEdgePathSnapshot[],
  restorePaths: boolean,
) {
  for (const el of f.layers) el.style.removeProperty('translate')
  f.multiSelect?.style.removeProperty('translate')
  if (!restorePaths) return
  for (const s of [...edges, ...f.childEdges]) {
    for (const path of s.paths) if (path.element.isConnected) path.element.setAttribute('d', path.d)
    if (s.deleteButton?.element.isConnected) s.deleteButton.element.setAttribute('transform', s.deleteButton.transform)
  }
}
