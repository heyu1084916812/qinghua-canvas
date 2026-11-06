import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { sourcePortOf, targetPortOf } from '../../../domain/canvas/model/edge'
import type { RunMode } from '../../../domain/canvas/model/runRecord'
import type { RunTaskState } from '../../../features/shared/execution/runEngine'
import { describeError } from '../../../shared/result'
import { childEdgeIdSet } from './childEdges'
import type { QhEdgeData } from './FlowEdge'
import type { FlowNodeData, FlowNodeDerivedProps } from './FlowNode'
import {
  isContainerType,
  nodeMeasurementKey,
  topLevelNodes,
} from './flowGraph'
import type { CanvasDetailMode } from './detailMode'
import type { NodeDerivedMaps } from '../useNodeDerivedMaps'

export function derivedPropsFor(
  derived: NodeDerivedMaps,
  id: string,
): FlowNodeDerivedProps {
  return {
    upstreamAssetHashes: derived.upstreamHashes.get(id),
    upstreamPromptCount: derived.upstreamPromptCounts.get(id),
    hasRunnableDownstream: derived.runnableDownstream.get(id),
    upstreamImageInputs: derived.upstreamImageInputs.get(id),
    inputPortAssets: derived.inputPortAssets.get(id),
  }
}

export function flowRunPresentationOf(state: RunTaskState | undefined): {
  running: boolean
  error: string | null
  runMode: RunMode
} {
  const running = state?.kind === 'queued' || state?.kind === 'running'
  const error = state?.kind === 'failed' ? describeError(state.error) : null
  const runMode: RunMode =
    state && (state.kind === 'queued' || state.kind === 'running' || state.kind === 'canceled')
      ? 'single'
      : 'idle'
  return { running, error, runMode }
}

export interface FlowNodeProjectionInput {
  graph: GraphSnapshot
  selection: readonly string[]
  detailMode: CanvasDetailMode
  derived: NodeDerivedMaps
  childIndex: ReadonlyMap<string, NodeSnapshot[]>
  nodeStateOf: (id: string) => RunTaskState | undefined
  emitFor: (id: string) => FlowNodeData['emit']
  resize: (
    id: string,
    rect: Parameters<FlowNodeData['resize']>[0],
    phase: Parameters<FlowNodeData['resize']>[1],
  ) => void
  renderChild?: FlowNodeData['renderChild']
}

export function flowNodesFor(input: FlowNodeProjectionInput): RFNode<FlowNodeData>[] {
  return topLevelNodes(input.graph).map((node) => {
    const run = flowRunPresentationOf(input.nodeStateOf(node.id))
    const children = input.childIndex.get(node.id) ?? []
    return {
      id: node.id,
      type: input.detailMode === 'coarse' ? 'coarse' : 'qh',
      position: { x: node.x, y: node.y },
      width: node.w,
      height: node.h,
      selected: input.selection.includes(node.id),
      style: { width: node.w, height: node.h },
      data: {
        node,
        ...run,
        emit: input.emitFor(node.id),
        resize: (rect, phase) => input.resize(node.id, rect, phase),
        ...derivedPropsFor(input.derived, node.id),
        ...(isContainerType(node.type)
          ? {
              childNodes: children,
              renderChild: children.length > 0 ? input.renderChild : undefined,
            }
          : {}),
      } satisfies FlowNodeData,
    }
  })
}

export interface FlowEdgeProjectionInput {
  graph: GraphSnapshot
  selection: readonly string[]
  edgeSelection: readonly string[]
  detailMode: CanvasDetailMode
  removeEdge: (id: string) => void
}

export function flowEdgesFor(input: FlowEdgeProjectionInput): RFEdge<QhEdgeData>[] {
  if (input.detailMode === 'coarse') return []
  const selectedNodes = new Set(input.selection)
  const childEdgeIds = childEdgeIdSet(input.graph)
  return input.graph.edges
    .filter((edge) => !childEdgeIds.has(edge.id))
    .map((edge) => ({
      id: edge.id,
      type: 'qh',
      source: edge.source,
      target: edge.target,
      sourceHandle: sourcePortOf(edge),
      targetHandle: targetPortOf(edge),
      selected: input.edgeSelection.includes(edge.id),
      data: {
        sourcePort: sourcePortOf(edge),
        targetPort: targetPortOf(edge),
        related: selectedNodes.has(edge.source) || selectedNodes.has(edge.target),
        onDelete: input.removeEdge,
      } satisfies QhEdgeData,
    }))
}

export function flowMeasurementKey(graph: GraphSnapshot): string {
  const edgeKey = graph.edges
    .map(
      (edge) =>
        `${edge.id}:${edge.source}>${edge.target}:${edge.sourcePort ?? ''}>${
          edge.targetPort ?? ''
        }`,
    )
    .join(',')
  return `${nodeMeasurementKey(graph)}||${edgeKey}`
}
