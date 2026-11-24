import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Edge } from '../../../domain/canvas/model/edge'
import { indexNodes } from '../../../domain/canvas/model/graph'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { portDeclOf } from '../../../domain/canvas/nodeSpecs/ports'
import { portAnchorWorld } from '../../../features/canvas/useEdgeDrag'
import { getBezierPath, Position } from '@xyflow/react'

/**
 * 所有自绘连线（手势层 / 容器子边）都走 RF 的 `getBezierPath`：与 `QhEdge` 逐字同一条曲线，
 * 切层（单击、平移起止）时形状和端点都不跳。返回 RF 格式 `M x,y C x,y x,y x,y`（世界坐标）。
 */
export function flowEdgeBezierPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSide: 'left' | 'right' = 'right',
  toSide: 'left' | 'right' = 'left',
): string {
  return getBezierPath({
    sourceX: from.x,
    sourceY: from.y,
    sourcePosition: fromSide === 'left' ? Position.Left : Position.Right,
    targetX: to.x,
    targetY: to.y,
    targetPosition: toSide === 'right' ? Position.Right : Position.Left,
  })[0]
}

/** 世界坐标路径 → 屏幕坐标（`(v - viewport) * zoom`） */
export function toScreenPath(d: string, viewport: { x: number; y: number }, zoom: number): string {
  let index = 0
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (raw) => {
    const offset = index++ % 2 === 0 ? viewport.x : viewport.y
    return String(Math.round((Number(raw) - offset) * zoom * 1000) / 1000)
  })
}

export interface ChildEdgePath {
  id: string
  source: string
  target: string
  /** SVG path（**屏幕坐标**，与 `FlowDraftLayer` 同一套换算） */
  d: string
  /** 两端里有被选中的节点（与 RF 边的 `related` 高亮同一条判据） */
  related: boolean
}

/**
 * **牵涉容器子节点的边**——RF 画不了它们，得由覆盖层补画。
 *
 * 为什么 RF 画不了：React Flow 的边按 `source / target` 找**它自己的节点**，
 * 而容器子节点不是 RF 节点（由容器网格渲染，见 `FlowNode` 的长注释）⇒ 这类边在 RF 里
 * 找不到端点，会**静默消失**。
 *
 * 为什么现在才有这类边：打组改口径（用户 2026-10-06 第 13 批第 5 条）之前，
 * 规则 4 禁止"容器内节点与外部连线"；现在组的右端点拉出来就是
 * **组内成员各连一条到目标**，于是这类边必须画得出来。
 *
 * 端点取**各自端口的世界锚点**（`portAnchorWorld`）：子节点的坐标是相对父容器的，
 * 走 `toWorldRectInGraph` 换算（与跟随栏 / 落点判定同一条口径）。
 */
/**
 * 这条边是否牵涉**容器子节点**（任一端是容器子节点）。
 *
 * 是 ⇒ RF 画不了（见 `childEdgePaths` 的说明），必须从 RF 的边列表里**摘出去**、
 * 交给 `FlowChildEdgeLayer` 画；否则它在 RF 里会静默消失，而数据里其实有这条边
 * （"图里连上了、屏幕上什么都没有"）。
 */
export function isChildEdge(
  graph: GraphSnapshot,
  e: { source: string; target: string },
): boolean {
  const index = indexNodes(graph.nodes)
  return isChildEdgeInIndex(index, e)
}

function isChildEdgeInIndex(
  index: Map<string, GraphSnapshot['nodes'][number]>,
  e: { source: string; target: string },
): boolean {
  const child = (id: string) => !!index.get(id)?.parentId
  return child(e.source) || child(e.target)
}

export function childEdgeIdSet(graph: GraphSnapshot): Set<string> {
  const index = indexNodes(graph.nodes)
  const out = new Set<string>()
  for (const edge of graph.edges) {
    if (isChildEdgeInIndex(index, edge)) out.add(edge.id)
  }
  return out
}

export function childEdgePaths(
  graph: GraphSnapshot,
  viewport: { x: number; y: number; zoom: number },
  selection: readonly string[],
): ChildEdgePath[] {
  const index = indexNodes(graph.nodes)
  const zoom = viewport.zoom || 1
  const out: ChildEdgePath[] = []

  for (const e of graph.edges as readonly Edge[]) {
    if (!isChildEdgeInIndex(index, e)) continue
    const src = index.get(e.source)
    const tgt = index.get(e.target)
    if (!src || !tgt) continue

    const srcDecl = portDeclOf(getSpec(src.type)?.ports ?? { input: false, output: false }, e.sourcePort ?? 'output')
    const tgtDecl = portDeclOf(getSpec(tgt.type)?.ports ?? { input: false, output: false }, e.targetPort ?? 'input')
    if (!srcDecl || !tgtDecl) continue

    /**
     * 锚点一律在**节点边缘**上（第 15 批澄清：线从节点边缘起步，端点只是动效点）——
     * 所以这里不再按"顶层 / 容器子节点"分流。
     */
    const from = portAnchorWorld(toWorldRectInGraph(src, graph), srcDecl)
    const to = portAnchorWorld(toWorldRectInGraph(tgt, graph), tgtDecl)
    out.push({
      id: e.id,
      source: e.source,
      target: e.target,
      d: toScreenPath(flowEdgeBezierPath(from, to, srcDecl.side, tgtDecl.side), viewport, zoom),
      related: selection.includes(e.source) || selection.includes(e.target),
    })
  }
  return out
}
