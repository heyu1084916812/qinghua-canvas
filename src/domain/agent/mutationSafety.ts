import type { GraphSnapshot } from '../canvas/model/graph'
import type { Edge } from '../canvas/model/edge'
import type { NodeSnapshot } from '../canvas/model/node'

export const MUTATION_PRECONDITION_KEY = '__lightCanvasPrecondition'

export const MUTATION_PRECONDITION_TOOLS = new Set([
  'applyPlan',
  'applyCanvasBatch',
  'renameNode',
  'updateNode',
  'deleteNodes',
  'deleteEdges',
  'moveNodes',
  'arrangeNodes',
  'resizeNodes',
  'compareNodes',
  'sliceImage',
  'splitGrid',
  'runNode',
  'runFrom',
])

export type MutationTargetKind = 'node' | 'edge'

export interface MutationTargetToken {
  kind: MutationTargetKind
  id: string
  digest: string
}

export interface MutationPrecondition {
  schema: 'qinghua.mutation.v1'
  revision: number
  targets: MutationTargetToken[]
}

export type CanvasBatchStep =
  | { op: 'rename'; nodeId: string; title: string }
  | { op: 'move'; nodeIds: string[]; dx: number; dy: number }
  | { op: 'deleteEdges'; edgeIds: string[] }
  | { op: 'deleteNodes'; nodeIds: string[] }

export type MutationCallPreparation =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; problems: string[] }

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

function stateDigest(value: unknown): string {
  const text = JSON.stringify(stableValue(value))
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    first ^= code
    first = Math.imul(first, 0x01000193)
    second ^= code + index
    second = Math.imul(second, 0x85ebca6b)
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`
}

export function nodeStateDigest(node: NodeSnapshot): string {
  return stateDigest(node)
}

export function edgeStateDigest(edge: Edge): string {
  return stateDigest(edge)
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
    : []
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeCanvasBatchSteps(value: unknown): {
  ok: true
  steps: CanvasBatchStep[]
} | {
  ok: false
  problems: string[]
} {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, problems: ['steps 至少需要一条操作'] }
  }
  if (value.length > 20) {
    return { ok: false, problems: ['一次批量操作最多 20 步'] }
  }
  const steps: CanvasBatchStep[] = []
  for (let index = 0; index < value.length; index += 1) {
    const row = recordOf(value[index])
    const op = typeof row.op === 'string' ? row.op : ''
    if (op === 'rename') {
      const nodeId = typeof row.nodeId === 'string' ? row.nodeId.trim() : ''
      const title = typeof row.title === 'string' ? row.title.trim() : ''
      if (!nodeId || !title) {
        return { ok: false, problems: [`第 ${index + 1} 步 rename 缺少 nodeId 或 title`] }
      }
      if (title.length > 120) {
        return { ok: false, problems: [`第 ${index + 1} 步 title 不能超过 120 字`] }
      }
      steps.push({ op, nodeId, title })
      continue
    }
    if (op === 'move') {
      const nodeIds = [...new Set(stringsOf(row.nodeIds))]
      const dx = Number(row.dx)
      const dy = Number(row.dy)
      if (nodeIds.length === 0 || !Number.isFinite(dx) || !Number.isFinite(dy)) {
        return {
          ok: false,
          problems: [`第 ${index + 1} 步 move 需要 nodeIds 与有限的 dx / dy`],
        }
      }
      if (dx === 0 && dy === 0) {
        return { ok: false, problems: [`第 ${index + 1} 步 move 位移不能同时为 0`] }
      }
      steps.push({ op, nodeIds, dx, dy })
      continue
    }
    if (op === 'deleteEdges') {
      const edgeIds = [...new Set(stringsOf(row.edgeIds))]
      if (edgeIds.length === 0) {
        return { ok: false, problems: [`第 ${index + 1} 步 deleteEdges 缺少 edgeIds`] }
      }
      steps.push({ op, edgeIds })
      continue
    }
    if (op === 'deleteNodes') {
      const nodeIds = [...new Set(stringsOf(row.nodeIds))]
      if (nodeIds.length === 0) {
        return { ok: false, problems: [`第 ${index + 1} 步 deleteNodes 缺少 nodeIds`] }
      }
      steps.push({ op, nodeIds })
      continue
    }
    return {
      ok: false,
      problems: [`第 ${index + 1} 步 op 只支持 rename / move / deleteEdges / deleteNodes`],
    }
  }
  return { ok: true, steps }
}

function batchNodeIds(steps: readonly CanvasBatchStep[]): string[] {
  return steps.flatMap((step) =>
    step.op === 'rename'
      ? [step.nodeId]
      : step.op === 'move' || step.op === 'deleteNodes'
        ? step.nodeIds
        : [],
  )
}

function batchEdgeIds(steps: readonly CanvasBatchStep[]): string[] {
  return steps.flatMap((step) => (step.op === 'deleteEdges' ? step.edgeIds : []))
}

function targetsForTool(
  name: string,
  args: Record<string, unknown>,
  graph: GraphSnapshot,
): { nodeIds: string[]; edgeIds: string[] } | { problems: string[] } {
  if (name === 'applyCanvasBatch') {
    const normalized = normalizeCanvasBatchSteps(args.steps)
    if (!normalized.ok) return normalized
    return {
      nodeIds: [...new Set(batchNodeIds(normalized.steps))],
      edgeIds: [...new Set(batchEdgeIds(normalized.steps))],
    }
  }
  if (name === 'renameNode') {
    const nodeId = typeof args.nodeId === 'string' ? args.nodeId.trim() : ''
    return nodeId ? { nodeIds: [nodeId], edgeIds: [] } : { problems: ['缺少 nodeId'] }
  }
  if (name === 'updateNode') {
    const nodeIds = [...new Set([...stringsOf(args.nodeIds), ...(typeof args.nodeId === 'string' ? [args.nodeId] : [])])]
    return nodeIds.length > 0 ? { nodeIds, edgeIds: [] } : { problems: ['缺少 nodeId'] }
  }
  if (
    name === 'deleteNodes' ||
    name === 'moveNodes' ||
    name === 'arrangeNodes' ||
    name === 'resizeNodes' ||
    name === 'runNode'
  ) {
    const nodeIds = [...new Set(stringsOf(args.nodeIds))]
    return nodeIds.length > 0 ? { nodeIds, edgeIds: [] } : { problems: ['缺少 nodeIds'] }
  }
  if (name === 'runFrom') {
    const starts = [...new Set(stringsOf(args.nodeIds))]
    if (starts.length === 0) return { problems: ['缺少 nodeIds'] }
    const reachable = new Set(starts)
    for (const edge of graph.edges) {
      if (reachable.has(edge.source)) reachable.add(edge.target)
    }
    return { nodeIds: [...reachable], edgeIds: [] }
  }
  if (name === 'deleteEdges') {
    const edgeIds = new Set(stringsOf(args.edgeIds))
    for (const pair of Array.isArray(args.pairs) ? args.pairs.map(recordOf) : []) {
      const source = typeof pair.source === 'string' ? pair.source : ''
      const target = typeof pair.target === 'string' ? pair.target : ''
      for (const edge of graph.edges) {
        if (edge.source === source && edge.target === target) edgeIds.add(edge.id)
      }
    }
    return edgeIds.size > 0
      ? { nodeIds: [], edgeIds: [...edgeIds] }
      : { problems: ['没有找到要删除的连线'] }
  }
  if (name === 'applyPlan') {
    const nodeIds = Array.isArray(args.attach)
      ? args.attach
          .map(recordOf)
          .map((item) => (typeof item.existingNodeId === 'string' ? item.existingNodeId : ''))
          .filter(Boolean)
      : []
    return { nodeIds: [...new Set(nodeIds)], edgeIds: [] }
  }
  if (name === 'compareNodes') {
    return {
      nodeIds: [args.leftNodeId, args.rightNodeId].filter(
        (value): value is string => typeof value === 'string' && Boolean(value),
      ),
      edgeIds: [],
    }
  }
  if (name === 'sliceImage' || name === 'splitGrid') {
    const nodeId = typeof args.nodeId === 'string' ? args.nodeId.trim() : ''
    return nodeId ? { nodeIds: [nodeId], edgeIds: [] } : { problems: ['缺少 nodeId'] }
  }
  return { nodeIds: [], edgeIds: [] }
}

/**
 * 预检并把目标状态写成隐藏前置条件。确认卡展示与持久化都使用返回的 args；
 * 真正执行前再按同一组 token 比较，所以只看“被操作对象”有没有变化，
 * 不会因无关节点移动而误拦。
 */
export function prepareMutationCall(input: {
  name: string
  args: Record<string, unknown>
  graph: GraphSnapshot
  revision: number
}): MutationCallPreparation {
  if (input.name === 'renameNode') {
    const title = typeof input.args.title === 'string' ? input.args.title.trim() : ''
    if (!title) return { ok: false, problems: ['renameNode 需要非空 title'] }
    if (title.length > 120) return { ok: false, problems: ['节点名称最多 120 字'] }
  }
  const targets = targetsForTool(input.name, input.args, input.graph)
  if ('problems' in targets) return { ok: false, problems: targets.problems }
  const nodeIds = [...new Set(targets.nodeIds)]
  const edgeIds = [...new Set(targets.edgeIds)]
  const missingNodes = nodeIds.filter((id) => !input.graph.nodes.some((node) => node.id === id))
  const missingEdges = edgeIds.filter((id) => !input.graph.edges.some((edge) => edge.id === id))
  const problems = [
    ...missingNodes.map((id) => `节点不存在：${id}`),
    ...missingEdges.map((id) => `连线不存在：${id}`),
  ]
  if (problems.length > 0) return { ok: false, problems }
  const tokens: MutationTargetToken[] = [
    ...nodeIds.flatMap((id) => {
      const node = input.graph.nodes.find((item) => item.id === id)
      return node ? [{ kind: 'node' as const, id, digest: nodeStateDigest(node) }] : []
    }),
    ...edgeIds.flatMap((id) => {
      const edge = input.graph.edges.find((item) => item.id === id)
      return edge ? [{ kind: 'edge' as const, id, digest: edgeStateDigest(edge) }] : []
    }),
  ]
  return {
    ok: true,
    args: {
      ...input.args,
      [MUTATION_PRECONDITION_KEY]: {
        schema: 'qinghua.mutation.v1',
        revision: input.revision,
        targets: tokens,
      } satisfies MutationPrecondition,
    },
  }
}

export function mutationPreconditionOf(args: unknown): MutationPrecondition | null {
  const raw = recordOf(args)[MUTATION_PRECONDITION_KEY]
  const row = recordOf(raw)
  if (
    row.schema !== 'qinghua.mutation.v1' ||
    typeof row.revision !== 'number' ||
    !Array.isArray(row.targets)
  ) {
    return null
  }
  const targets = row.targets.flatMap((item): MutationTargetToken[] => {
    const target = recordOf(item)
    return (target.kind === 'node' || target.kind === 'edge') &&
      typeof target.id === 'string' &&
      typeof target.digest === 'string'
      ? [{ kind: target.kind, id: target.id, digest: target.digest }]
      : []
  })
  return {
    schema: 'qinghua.mutation.v1',
    revision: Math.max(0, Math.trunc(row.revision)),
    targets,
  }
}

export function verifyMutationPrecondition(
  args: unknown,
  graph: GraphSnapshot,
): string[] {
  const precondition = mutationPreconditionOf(args)
  if (!precondition) return []
  return precondition.targets.flatMap((target) => {
    if (target.kind === 'node') {
      const node = graph.nodes.find((item) => item.id === target.id)
      if (!node) return [`节点「${target.id}」已被删除或替换，请重新读取画布后再操作`]
      if (nodeStateDigest(node) !== target.digest) {
        return [`节点「${node.title || target.id}」在确认后发生了变化，请重新读取后再操作`]
      }
      return []
    }
    const edge = graph.edges.find((item) => item.id === target.id)
    if (!edge) return [`连线「${target.id}」已被删除或替换，请重新读取画布后再操作`]
    if (edgeStateDigest(edge) !== target.digest) {
      return [`连线「${target.id}」在确认后发生了变化，请重新读取后再操作`]
    }
    return []
  })
}
