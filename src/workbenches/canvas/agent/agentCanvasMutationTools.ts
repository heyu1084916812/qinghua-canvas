import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { createId } from '../../../shared/id'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  avoidRectOverlap,
  isTopLevelNode,
  nodeMinSize,
  placeNodeWithoutOverlap,
  snapshotRects,
} from './agentGeometry'
import { asRecord, asStringArray } from './canvasReadTools'

function selectedNodes(store: CanvasStore, ids: readonly string[]) {
  const graph = store.getSnapshot()
  const unique = [...new Set(ids)]
  const nodes = unique.map((id) => graph.nodes.find((node) => node.id === id))
  const missing = unique.filter((_, index) => !nodes[index])
  return {
    unique,
    nodes: nodes.filter((node): node is NonNullable<typeof node> => !!node),
    missing,
  }
}

export async function moveNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要移动的节点'] }
  const { unique, nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点的位置与尺寸由容器管理，请把节点移出组后再操作'] }
  }

  const positionRows = Array.isArray(args.positions) ? args.positions.map(asRecord) : []
  const positions = new Map(
    positionRows.flatMap((row) => {
      const nodeId = typeof row.nodeId === 'string' ? row.nodeId : ''
      const x = Number(row.x)
      const y = Number(row.y)
      return nodeId && Number.isFinite(x) && Number.isFinite(y)
        ? [[nodeId, { x, y }] as const]
        : []
    }),
  )
  const dx = Number.isFinite(Number(args.dx)) ? Number(args.dx) : 0
  const dy = Number.isFinite(Number(args.dy)) ? Number(args.dy) : 0
  if (positions.size === 0 && dx === 0 && dy === 0) {
    return { ok: false, problems: ['请提供 positions，或非零的 dx / dy'] }
  }
  if (positions.size > 0 && unique.some((id) => !positions.has(id))) {
    return { ok: false, problems: ['positions 必须覆盖 nodeIds 里的每一个节点'] }
  }

  store.beginPlan(`agent-move:${createId('plan')}`, 'Agent 移动节点')
  for (const node of nodes) placeNodeWithoutOverlap(store, node.id, {
    x: node.x + (positions.get(node.id) ? positions.get(node.id)!.x - node.x : dx),
    y: node.y + (positions.get(node.id) ? positions.get(node.id)!.y - node.y : dy),
    w: node.w,
    h: node.h,
  })
  store.endPlan()
  await store.flush()
  const after = store.getSnapshot().nodes
  return {
    ok: true,
    moved: nodes.map((node) => {
      const latest = after.find((item) => item.id === node.id) ?? node
      return { nodeId: node.id, x: Math.round(latest.x), y: Math.round(latest.y) }
    }),
  }
}

export async function arrangeNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length < 2) return { ok: false, problems: ['至少需要 2 个节点才能排列'] }
  const { unique, nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点由容器自动排版，不需要再排列'] }
  }
  const parents = new Set(nodes.map((node) => node.parentId ?? null))
  if (parents.size > 1) {
    return { ok: false, problems: ['一次只能排列同一层级的节点，不能混排分组内外的节点'] }
  }
  const layout = String(args.layout ?? '')
  if (!['horizontal', 'vertical', 'grid'].includes(layout)) {
    return { ok: false, problems: ['layout 只能是 horizontal / vertical / grid'] }
  }
  const gapRaw = Number(args.gap)
  const gap = Number.isFinite(gapRaw) ? Math.min(240, Math.max(8, gapRaw)) : 32
  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)
  const left = Math.min(...ordered.map((node) => node.x))
  const top = Math.min(...ordered.map((node) => node.y))
  const targets = new Map<string, { x: number; y: number }>()

  if (layout === 'horizontal') {
    let cursor = left
    for (const node of ordered) {
      targets.set(node.id, { x: cursor, y: top })
      cursor += node.w + gap
    }
  } else if (layout === 'vertical') {
    let cursor = top
    for (const node of ordered) {
      targets.set(node.id, { x: left, y: cursor })
      cursor += node.h + gap
    }
  } else {
    const columnsRaw = Number(args.columns)
    const columns = Number.isFinite(columnsRaw)
      ? Math.min(ordered.length, Math.max(1, Math.floor(columnsRaw)))
      : Math.min(ordered.length, Math.ceil(Math.sqrt(ordered.length)))
    const rows = Math.ceil(ordered.length / columns)
    const colWidths = Array.from({ length: columns }, (_, col) =>
      Math.max(...ordered.filter((_, index) => index % columns === col).map((node) => node.w)),
    )
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(
        ...ordered
          .slice(row * columns, (row + 1) * columns)
          .map((node) => node.h),
      ),
    )
    ordered.forEach((node, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      targets.set(node.id, {
        x: left + colWidths.slice(0, col).reduce((sum, width) => sum + width + gap, 0),
        y: top + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0),
      })
    })
  }

  store.beginPlan(`agent-arrange:${createId('plan')}`, 'Agent 排列节点')
  const graph = store.getSnapshot()
  const settled: { x: number; y: number; w: number; h: number }[] = []
  const fixed = snapshotRects(graph.nodes.filter((other) => !unique.includes(other.id)))
  const remaining = ordered.map((node) => ({ ...node }))
  while (remaining.length > 0) {
    const node = remaining.shift()!
    const current = remaining.map((item) => ({ ...item }))
    const target = targets.get(node.id)!
    const final = avoidRectOverlap(
      { ...node, ...target },
      [
        ...fixed,
        ...settled,
        ...current,
      ],
      undefined,
      'right',
    )
    targets.set(node.id, { x: final.x, y: final.y })
    store.dispatch({
      kind: 'node.move',
      ids: [node.id],
      dx: final.x - node.x,
      dy: final.y - node.y,
      phase: 'end',
    })
    settled.push({ x: final.x, y: final.y, w: node.w, h: node.h })
  }
  store.endPlan()
  await store.flush()
  return {
    ok: true,
    layout,
    positions: ordered.map((node) => ({
      nodeId: node.id,
      x: Math.round(targets.get(node.id)!.x),
      y: Math.round(targets.get(node.id)!.y),
    })),
  }
}

export async function resizeNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要调整的节点'] }
  const { nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点的位置与尺寸由容器管理，请把节点移出组后再调整'] }
  }
  const scale = Number(args.scale)
  const width = Number(args.width)
  const height = Number(args.height)
  const scaled = Number.isFinite(scale) && scale > 0
  const uniformWidth = Number.isFinite(width) && width > 0
  const uniformHeight = Number.isFinite(height) && height > 0
  const specified = Number(scaled) + Number(uniformWidth) + Number(uniformHeight)
  if (specified > 1) {
    return { ok: false, problems: ['width / height / scale 只能指定其中一项'] }
  }
  if (specified === 0 && args.useMax !== true) {
    return { ok: false, problems: ['请提供 width / height / scale，或 useMax:true'] }
  }
  const useMax = args.useMax === true
  const uniformW = uniformWidth
    ? Number.isFinite(width)
      ? width
      : useMax
        ? Math.max(...nodes.map((node) => node.w))
        : Math.min(...nodes.map((node) => node.w))
    : 0
  const uniformH = uniformHeight
    ? Number.isFinite(height)
      ? height
      : useMax
        ? Math.max(...nodes.map((node) => node.h))
        : Math.min(...nodes.map((node) => node.h))
    : 0
  const changes = nodes.map((node) => {
    const ratio = node.w / Math.max(1, node.h)
    let w = node.w
    let h = node.h
    if (scaled) {
      w *= scale
      h *= scale
    } else if (uniformWidth) {
      w = uniformW
      h = uniformW / ratio
    } else {
      h = uniformH
      w = uniformH * ratio
    }
    const min = nodeMinSize(node)
    /**
     * 最小尺寸也必须等比放大。分别对宽高取 max 会把 16:10 变成 1.25:1，
     * 用户看到的是图片被拉伸，和工具承诺的“保持原始宽高比”冲突。
     */
    const minScale = Math.max(
      1,
      min.w / Math.max(1, w),
      min.h / Math.max(1, h),
    )
    const rect = {
      x: node.x,
      y: node.y,
      w: w * minScale,
      h: h * minScale,
    }
    return { node, rect }
  })
  const graph = store.getSnapshot()
  store.beginPlan(`agent-resize:${createId('plan')}`, 'Agent 调整节点尺寸')
  const adjusted: { nodeId: string; w: number; h: number; x: number; y: number }[] = []
  for (const { node, rect } of changes) {
    const occupied = [
      ...snapshotRects(graph.nodes.filter((other) => !ids.includes(other.id))),
      ...nodes
        .filter((other) => other.id !== node.id)
        .map((other) => {
          const previous = adjusted.find((item) => item.nodeId === other.id)
          return previous ?? { x: other.x, y: other.y, w: other.w, h: other.h }
        }),
    ]
    const final = avoidRectOverlap(rect, occupied, undefined, 'right')
    store.dispatch({ kind: 'node.resize', id: node.id, rect: final, phase: 'end' })
    const moved = placeNodeWithoutOverlap(store, node.id, final)
    adjusted.push({
      nodeId: node.id,
      w: Math.round(final.w),
      h: Math.round(final.h),
      x: Math.round(moved.x),
      y: Math.round(moved.y),
    })
  }
  store.endPlan()
  await store.flush()
  return { ok: true, nodes: adjusted }
}

export async function deleteNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要删除的节点'] }
  const { nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  const graph = store.getSnapshot()
  const beforeIds = new Set(graph.nodes.map((node) => node.id))
  store.dispatch({ kind: 'node.delete', ids: nodes.map((node) => node.id) })
  await store.flush()
  return {
    ok: true,
    deletedNodeIds: [...beforeIds].filter(
      (id) => !store.getSnapshot().nodes.some((node) => node.id === id),
    ),
  }
}

export async function deleteEdgesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const graph = store.getSnapshot()
  const requested = new Set(asStringArray(args.edgeIds))
  const pairs = Array.isArray(args.pairs) ? args.pairs.map(asRecord) : []
  for (const edge of graph.edges) {
    if (
      pairs.some(
        (pair) =>
          pair.source === edge.source &&
          pair.target === edge.target,
      )
    ) {
      requested.add(edge.id)
    }
  }
  const existing = [...requested].filter((id) => graph.edges.some((edge) => edge.id === id))
  if (existing.length === 0) {
    return { ok: false, problems: ['没有找到要删除的连线'] }
  }
  store.beginPlan(`agent-unlink:${createId('plan')}`, 'Agent 取消连线')
  for (const id of existing) store.dispatch({ kind: 'edge.remove', id })
  store.endPlan()
  await store.flush()
  return { ok: true, deletedEdgeIds: existing }
}

export async function compareNodesInStore(
  store: CanvasStore,
  args: Record<string, unknown>,
) {
  const leftId = typeof args.leftNodeId === 'string' ? args.leftNodeId : ''
  const rightId = typeof args.rightNodeId === 'string' ? args.rightNodeId : ''
  if (!leftId || !rightId || leftId === rightId) {
    return { ok: false, problems: ['需要两个不同的节点 id'] }
  }
  const graph = store.getSnapshot()
  const left = graph.nodes.find((node) => node.id === leftId)
  const right = graph.nodes.find((node) => node.id === rightId)
  if (!left || !right) return { ok: false, problems: ['对比节点不存在'] }
  if (
    !(left.data as { assetHash?: unknown }).assetHash ||
    !(right.data as { assetHash?: unknown }).assetHash
  ) {
    return { ok: false, problems: ['两个节点都必须已有图片'] }
  }
  if ((left.parentId ?? null) !== (right.parentId ?? null)) {
    return { ok: false, problems: ['对比的两个节点必须在同一层级'] }
  }
  if (left.parentId || right.parentId) {
    return { ok: false, problems: ['组内节点请移出组后再创建对比节点'] }
  }
  const spec = getSpec('compare')
  if (!spec) return { ok: false, problems: ['对比节点尚未注册'] }
  const id = createId('node')
  const at = {
    x: Math.max(left.x + left.w, right.x + right.w) + 80,
    y: Math.min(left.y, right.y),
  }
  const comparisonSize = getSpec('compare')?.sizing?.min ?? { w: 360, h: 270 }
  const placedAt = avoidRectOverlap(
    { ...at, ...comparisonSize },
    graph.nodes.map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h })),
  )
  store.beginPlan(`agent-compare:${id}`, 'Agent 创建对比')
  store.dispatch({
    kind: 'node.create',
    projectId: graph.projectId,
    type: 'compare',
    id,
    at: placedAt,
    title: `${left.title} / ${right.title} 对比`,
    ...(left.parentId ? { parentId: left.parentId } : {}),
    data: spec.createDefaultData(),
  })
  store.dispatch({ kind: 'edge.connect', source: left.id, target: id })
  store.dispatch({ kind: 'edge.connect', source: right.id, target: id })
  store.endPlan()
  store.setSelection([id])
  await store.flush()
  return { ok: true, compareNodeId: id }
}
