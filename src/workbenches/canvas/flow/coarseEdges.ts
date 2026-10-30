import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Edge } from '../../../domain/canvas/model/edge'
import { indexNodes } from '../../../domain/canvas/model/graph'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { portDeclOf } from '../../../domain/canvas/nodeSpecs/ports'
import { portAnchorWorld } from '../../../features/canvas/useEdgeDrag'
import { childEdgeIdSet } from './childEdges'

export interface CoarseEdgePath {
  id: string
  source: string
  target: string
  sourcePort: string
  targetPort: string
  d: string
  related: boolean
  selected: boolean
}

export function coarseEdgePaths(
  graph: GraphSnapshot,
  selection: readonly string[],
  edgeSelection: readonly string[] = [],
): CoarseEdgePath[] {
  const index = indexNodes(graph.nodes)
  const childEdges = childEdgeIdSet(graph)
  const selected = new Set(selection)
  const selectedEdges = new Set(edgeSelection)
  const out: CoarseEdgePath[] = []

  for (const edge of graph.edges as readonly Edge[]) {
    if (childEdges.has(edge.id)) continue
    const source = index.get(edge.source)
    const target = index.get(edge.target)
    if (!source || !target) continue

    const sourcePort = edge.sourcePort ?? 'output'
    const targetPort = edge.targetPort ?? 'input'
    const sourceDecl = portDeclOf(
      getSpec(source.type)?.ports ?? { input: false, output: false },
      sourcePort,
    )
    const targetDecl = portDeclOf(
      getSpec(target.type)?.ports ?? { input: false, output: false },
      targetPort,
    )
    if (!sourceDecl || !targetDecl) continue

    const from = portAnchorWorld(toWorldRectInGraph(source, graph), sourceDecl)
    const to = portAnchorWorld(toWorldRectInGraph(target, graph), targetDecl)
    const dx = Math.max(40, Math.abs(to.x - from.x) / 2)
    out.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourcePort,
      targetPort,
      d: `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`,
      related: selected.has(edge.source) || selected.has(edge.target),
      selected: selectedEdges.has(edge.id),
    })
  }

  return out
}
