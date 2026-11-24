import type { Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { sourcePortOf, targetPortOf } from '../../../domain/canvas/model/edge'
import type { RunMode } from '../../../domain/canvas/model/runRecord'
import type { RunTaskState } from '../../../features/shared/execution/runEngine'
import { describeError } from '../../../shared/result'
import type { QhEdgeData } from './FlowEdge'
import type { FlowNodeData, FlowNodeDerivedProps } from './FlowNode'
import {
  isContainerType,
  nodeMeasurementKey,
  topLevelNodes,
} from './flowGraph'
import type { NodeDerivedMaps } from '../useNodeDerivedMaps'

export function derivedPropsFor(derived: NodeDerivedMaps, id: string, upstreamPickDimmed = false): FlowNodeDerivedProps {
  return {
    upstreamAssetHashes: derived.upstreamHashes.get(id),
    upstreamPromptCount: derived.upstreamPromptCounts.get(id),
    hasRunnableDownstream: derived.runnableDownstream.get(id),
    upstreamImageInputs: derived.upstreamImageInputs.get(id),
    inputPortAssets: derived.inputPortAssets.get(id),
    excluded: derived.excluded.has(id),
    upstreamPickDimmed,
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
  upstreamPick?: { nodeId: string; allowedIds: ReadonlySet<string> } | null
  /** During a drag React Flow already moves the wrapper; node content can stay stable. */
  optimisticDrag?: boolean
}

function sameDerivedProjection(
  previous: FlowNodeData,
  next: FlowNodeDerivedProps,
): boolean {
  return (
    previous.upstreamAssetHashes === next.upstreamAssetHashes &&
    previous.upstreamPromptCount === next.upstreamPromptCount &&
    previous.hasRunnableDownstream === next.hasRunnableDownstream &&
    previous.upstreamImageInputs === next.upstreamImageInputs &&
    previous.inputPortAssets === next.inputPortAssets &&
    previous.excluded === next.excluded &&
    previous.upstreamPickDimmed === next.upstreamPickDimmed
  )
}

export function flowNodesFor(
  input: FlowNodeProjectionInput,
  previous: readonly RFNode<FlowNodeData>[] = [],
): RFNode<FlowNodeData>[] {
  const previousById = new Map(previous.map((node) => [node.id, node]))
  return topLevelNodes(input.graph).map((node) => {
    const type = 'qh'
    const selected = input.selection.includes(node.id)
    const run = flowRunPresentationOf(input.nodeStateOf(node.id))
    const children = input.childIndex.get(node.id) ?? []
    const derived = derivedPropsFor(
      input.derived,
      node.id,
      Boolean(
        input.upstreamPick &&
          !input.upstreamPick.allowedIds.has(node.id),
      ),
    )
    const emit = input.emitFor(node.id)
    const old = previousById.get(node.id)
    const sameRenderContent =
      old &&
      old.type === type &&
      old.width === node.w &&
      old.height === node.h &&
      old.selected === selected &&
      old.data.node.id === node.id &&
      old.data.node.type === node.type &&
      old.data.node.parentId === node.parentId &&
      old.data.node.w === node.w &&
      old.data.node.h === node.h &&
      old.data.node.title === node.title &&
      old.data.node.disabled === node.disabled &&
      old.data.node.data === node.data &&
      old.data.running === run.running &&
      old.data.error === run.error &&
      old.data.runMode === run.runMode &&
      old.data.emit === emit &&
      sameDerivedProjection(old.data, derived)
    if (
      old &&
      !isContainerType(node.type) &&
      old.type === type &&
      old.position.x === node.x &&
      old.position.y === node.y &&
      old.width === node.w &&
      old.height === node.h &&
      old.selected === selected &&
      old.data.node === node &&
      old.data.running === run.running &&
      old.data.error === run.error &&
      old.data.runMode === run.runMode &&
      old.data.emit === emit &&
      sameDerivedProjection(old.data, derived)
    ) {
      return old
    }
    if (
      old &&
      sameRenderContent &&
      input.optimisticDrag &&
      !isContainerType(node.type) &&
      (old.position.x !== node.x || old.position.y !== node.y)
    ) {
      return {
        ...old,
        position: { x: node.x, y: node.y },
      }
    }
    return {
      id: node.id,
      type,
      position: { x: node.x, y: node.y },
      width: node.w,
      height: node.h,
      selected,
      style: { width: node.w, height: node.h },
      data: {
        node,
        ...run,
        emit,
        resize: (rect, phase) => input.resize(node.id, rect, phase),
        ...derived,
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
  edges: GraphSnapshot['edges']
  childEdgeIds: ReadonlySet<string>
  selection: readonly string[]
  edgeSelection: readonly string[]
  removeEdge: (id: string) => void
}

export function flowEdgesFor(
  input: FlowEdgeProjectionInput,
  previous: readonly RFEdge<QhEdgeData>[] = [],
): RFEdge<QhEdgeData>[] {
  const selectedNodes = new Set(input.selection)
  const previousById = new Map(previous.map((edge) => [edge.id, edge]))
  return input.edges
    .filter((edge) => !input.childEdgeIds.has(edge.id))
    .map((edge) => {
      const sourcePort = sourcePortOf(edge)
      const targetPort = targetPortOf(edge)
      const selected = input.edgeSelection.includes(edge.id)
      const related =
        selectedNodes.has(edge.source) || selectedNodes.has(edge.target)
      const old = previousById.get(edge.id)
      if (
        old &&
        old.type === 'qh' &&
        old.source === edge.source &&
        old.target === edge.target &&
        old.sourceHandle === sourcePort &&
        old.targetHandle === targetPort &&
        old.selected === selected &&
        old.data?.sourcePort === sourcePort &&
        old.data?.targetPort === targetPort &&
        old.data?.related === related &&
        old.data?.onDelete === input.removeEdge
      ) {
        return old
      }
      return {
        id: edge.id,
        type: 'qh',
        source: edge.source,
        target: edge.target,
        sourceHandle: sourcePort,
        targetHandle: targetPort,
        selected,
        data: {
          sourcePort,
          targetPort,
          related,
          onDelete: input.removeEdge,
        } satisfies QhEdgeData,
      }
    })
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
