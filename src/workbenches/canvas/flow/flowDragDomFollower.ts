export interface FlowDragEdgePathHost {
  querySelectorAll(selector: string): ArrayLike<SVGPathElement>
}

export interface FlowNodeDragStart {
  id: string
  x: number
  y: number
}

export interface FlowDragNodeHost {
  querySelector(selector: string): { style: { transform: string } } | null
}

export interface FlowDragEdgePathSnapshot {
  source: string
  target: string
  paths: Array<{ element: SVGPathElement; d: string }>
}

const BEZIER_PATH =
  /^M\s*([^,\s]+),([^\s]+)\s+C\s*([^,\s]+),([^\s]+)\s+([^,\s]+),([^\s]+)\s+([^,\s]+),([^\s]+)$/i

function pathNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

export function writeFlowNodeDragDomPositions(
  host: FlowDragNodeHost,
  starts: readonly FlowNodeDragStart[],
  dx: number,
  dy: number,
): number {
  let written = 0
  for (const start of starts) {
    const id = start.id.replace(/["\\]/g, '\\$&')
    const element = host.querySelector(`.react-flow__node[data-id="${id}"]`)
    if (!element) continue
    element.style.transform =
      `translate(${start.x + dx}px, ${start.y + dy}px)`
    written += 1
  }
  return written
}

export function shiftFlowEdgePath(
  path: string,
  moveSource: boolean,
  moveTarget: boolean,
  dx: number,
  dy: number,
): string | null {
  const match = BEZIER_PATH.exec(path)
  if (!match) return null
  const values = match.slice(1).map(Number)
  if (values.some((value) => !Number.isFinite(value))) return null
  const sourceDx = moveSource ? dx : 0
  const sourceDy = moveSource ? dy : 0
  const targetDx = moveTarget ? dx : 0
  const targetDy = moveTarget ? dy : 0
  return [
    `M${pathNumber(values[0]! + sourceDx)},${pathNumber(values[1]! + sourceDy)}`,
    `C${pathNumber(values[2]! + sourceDx)},${pathNumber(values[3]! + sourceDy)}`,
    `${pathNumber(values[4]! + targetDx)},${pathNumber(values[5]! + targetDy)}`,
    `${pathNumber(values[6]! + targetDx)},${pathNumber(values[7]! + targetDy)}`,
  ].join(' ')
}

export function captureFlowDragEdgePaths(
  host: FlowDragEdgePathHost,
  movingIds: ReadonlySet<string>,
  edgeIds?: ReadonlySet<string>,
): FlowDragEdgePathSnapshot[] {
  const snapshots: FlowDragEdgePathSnapshot[] = []
  const visuals = edgeIds
    ? [...edgeIds].flatMap((id) =>
        Array.from(
          host.querySelectorAll(
            `[data-edge="${id.replace(/["\\]/g, '\\$&')}"]`,
          ),
        ),
      )
    : Array.from(host.querySelectorAll('[data-edge]'))
  for (const visual of visuals) {
    const source = visual.getAttribute('data-edge-source')
    const target = visual.getAttribute('data-edge-target')
    if (!source || !target) continue
    if (!movingIds.has(source) && !movingIds.has(target)) continue
    const group = visual.closest('.react-flow__edge')
    const candidates = group
      ? Array.from(group.querySelectorAll('path'))
      : [visual]
    const paths: Array<{ element: SVGPathElement; d: string }> = []
    const seen = new Set<SVGPathElement>()
    for (const element of candidates) {
      if (seen.has(element)) continue
      seen.add(element)
      const d = element.getAttribute('d')
      if (d) paths.push({ element, d })
    }
    snapshots.push({ source, target, paths })
  }
  return snapshots
}

export function writeFlowDragEdgePaths(
  snapshots: readonly FlowDragEdgePathSnapshot[],
  movingIds: ReadonlySet<string>,
  dx: number,
  dy: number,
): number {
  let written = 0
  for (const snapshot of snapshots) {
    const d = shiftFlowEdgePath(
      snapshot.paths[0]?.d ?? '',
      movingIds.has(snapshot.source),
      movingIds.has(snapshot.target),
      dx,
      dy,
    )
    if (!d) continue
    for (const path of snapshot.paths) path.element.setAttribute('d', d)
    written += 1
  }
  return written
}
