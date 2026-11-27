import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import {
  NODE_HEADER_HEIGHT,
  NODE_HEADER_SIDE_INSET,
  type NodeHeaderLabel,
} from './nodeHeaders'

export interface NodeHeaderOcclusion {
  /** 完全被上层节点遮挡，隐藏且不接收点击 */
  hidden: boolean
  /** 部分被上层节点遮挡时的局部坐标 `clip-path: path("...")` */
  clipPath?: string
  /** 与节点真实层叠顺序一致的标题间 z-index */
  zIndex?: number
}

interface Box {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface StackEntry {
  node: NodeSnapshot
  topId: string
  topSelected: number
  topIndex: number
  childSelected: number
  childIndex: number
  worldBox: Box
}

const EPS = 0.25

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function roundCoord(value: number): number {
  return Math.round(value * 100) / 100
}

function subtractBox(rects: readonly Box[], cut: Box): Box[] {
  const out: Box[] = []
  for (const r of rects) {
    const ix1 = Math.max(r.x1, cut.x1)
    const iy1 = Math.max(r.y1, cut.y1)
    const ix2 = Math.min(r.x2, cut.x2)
    const iy2 = Math.min(r.y2, cut.y2)
    if (ix2 - ix1 <= EPS || iy2 - iy1 <= EPS) {
      out.push(r)
      continue
    }
    if (iy1 - r.y1 > EPS) out.push({ x1: r.x1, y1: r.y1, x2: r.x2, y2: iy1 })
    if (r.y2 - iy2 > EPS) out.push({ x1: r.x1, y1: iy2, x2: r.x2, y2: r.y2 })
    if (ix1 - r.x1 > EPS) out.push({ x1: r.x1, y1: iy1, x2: ix1, y2: iy2 })
    if (r.x2 - ix2 > EPS) out.push({ x1: ix2, y1: iy1, x2: r.x2, y2: iy2 })
  }
  return out
}

function isStrictlyAbove(candidate: StackEntry, target: StackEntry): boolean {
  if (candidate.node.id === target.node.id) return false
  // 父容器底板在子节点之下，不能遮挡自己子节点的标题
  if (target.node.parentId === candidate.node.id) return false
  if (candidate.topId !== target.topId) {
    if (candidate.topSelected !== target.topSelected) {
      return candidate.topSelected > target.topSelected
    }
    return candidate.topIndex > target.topIndex
  }
  // 同一父容器内：子节点在父容器之上；兄弟之间按选中优先、后绘优先
  if (candidate.node.parentId && !target.node.parentId) return true
  if (candidate.childSelected !== target.childSelected) {
    return candidate.childSelected > target.childSelected
  }
  return candidate.childIndex > target.childIndex
}

function worldBoxOf(
  node: NodeSnapshot,
  byId: ReadonlyMap<string, NodeSnapshot>,
): Box {
  const parent = node.parentId ? byId.get(node.parentId) : null
  const x = parent?.type === 'group' ? parent.x + node.x : node.x
  const y = parent?.type === 'group' ? parent.y + node.y : node.y
  return { x1: x, y1: y, x2: x + node.w, y2: y + node.h }
}

/**
 * 计算每个外置节点标题被更高层级节点遮挡后的可见状态与 `clip-path`。
 * 保持 `FlowNodeHeaderLayer` 在 `.react-flow__node` 之外（不破坏 `content-visibility: auto`），
 * 同时让重叠节点的名称和像素严格遵守 React Flow 节点的真实层叠顺序。
 */
export function nodeHeaderOcclusions(
  labels: readonly NodeHeaderLabel[],
  nodes: readonly NodeSnapshot[],
  selection: readonly string[],
): Map<string, NodeHeaderOcclusion> {
  const result = new Map<string, NodeHeaderOcclusion>()
  if (labels.length === 0 || nodes.length === 0) return result

  const selectedSet = new Set(selection)
  const byId = new Map<string, NodeSnapshot>()
  const indexById = new Map<string, number>()
  nodes.forEach((node, index) => {
    byId.set(node.id, node)
    indexById.set(node.id, index)
  })

  const entries: StackEntry[] = nodes.map((node, index) => {
    const topId = node.parentId && byId.has(node.parentId) ? node.parentId : node.id
    const topIndex = indexById.get(topId) ?? index
    return {
      node,
      topId,
      topSelected: selectedSet.has(topId) ? 1 : 0,
      topIndex,
      childSelected: selectedSet.has(node.id) ? 1 : 0,
      childIndex: index,
      worldBox: worldBoxOf(node, byId),
    }
  })
  const entryById = new Map(entries.map((entry) => [entry.node.id, entry]))

  for (const label of labels) {
    const target = entryById.get(label.id)
    if (!target) continue

    const scale = label.scale || 1
    const boxLeftWorld = label.x - NODE_HEADER_SIDE_INSET * scale
    const boxTopWorld = label.y - (NODE_HEADER_HEIGHT + label.gap) * scale
    const localW = label.w / scale + NODE_HEADER_SIDE_INSET * 2
    const localH = NODE_HEADER_HEIGHT
    const boxRightWorld = boxLeftWorld + localW * scale
    const boxBottomWorld = boxTopWorld + localH * scale
    const zIndex = target.topSelected * 100_000 + target.topIndex * 100 + (target.node.parentId ? 10 : 0) + target.childSelected

    let visible: Box[] = [{ x1: 0, y1: 0, x2: localW, y2: localH }]
    let intersected = false

    for (const candidate of entries) {
      if (!isStrictlyAbove(candidate, target)) continue
      const wb = candidate.worldBox
      if (
        wb.x2 <= boxLeftWorld + EPS ||
        wb.x1 >= boxRightWorld - EPS ||
        wb.y2 <= boxTopWorld + EPS ||
        wb.y1 >= boxBottomWorld - EPS
      ) {
        continue
      }
      const cut: Box = {
        x1: clamp((wb.x1 - boxLeftWorld) / scale, 0, localW),
        y1: clamp((wb.y1 - boxTopWorld) / scale, 0, localH),
        x2: clamp((wb.x2 - boxLeftWorld) / scale, 0, localW),
        y2: clamp((wb.y2 - boxTopWorld) / scale, 0, localH),
      }
      if (cut.x2 - cut.x1 <= EPS || cut.y2 - cut.y1 <= EPS) continue
      intersected = true
      visible = subtractBox(visible, cut)
      if (visible.length === 0) break
    }

    if (!intersected) {
      result.set(label.id, { hidden: false, zIndex })
      continue
    }
    if (visible.length === 0) {
      result.set(label.id, { hidden: true, zIndex })
      continue
    }
    const d = visible
      .map(
        (r) =>
          `M${roundCoord(r.x1)} ${roundCoord(r.y1)}H${roundCoord(r.x2)}V${roundCoord(r.y2)}H${roundCoord(r.x1)}Z`,
      )
      .join(' ')
    result.set(label.id, { hidden: false, clipPath: `path("${d}")`, zIndex })
  }

  return result
}
