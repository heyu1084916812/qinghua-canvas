/**
 * 节点跟随功能栏的**锚点几何**（用户 2026-09-16 需求）。
 *
 * 抽成纯函数的理由与 `staleReport` / `planSlots` 同款：这类几何换算一旦算错，
 * 界面上的表现是「栏飞到画布左上角」或「栏压在节点上」，看渲染截图极难定位，
 * 而作为纯函数可以直接断言（见 NodeFollowBar.test.ts）。
 *
 * 换算口径与创作面板（`panels/PanelLayer.tsx`）完全一致：
 *   屏幕 = (世界 − 视口平移) × zoom
 * 差别只有纵向：面板在节点**下方**，本栏在**上方**（标题之上）。
 *
 * **不做「上方装不下就翻到下方」**（用户 2026-09-17）：节点顶到画布顶端时，
 * 栏一律保持在上方。翻转会让栏在节点上下横跳——同一个节点，用户只是往上拖了一点，
 * 栏就从上面跳到下面，比「暂时被顶栏压住」更难用。位置稳定优先于始终可见。
 */
import { toWorldRectInGraph, type Viewport } from '../../../domain/canvas/geometry/coords'
import { PORT_EDGE_GAP, PORT_SIZE } from '../../../domain/canvas/geometry/portReveal'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { portDeclsOf } from '../../../domain/canvas/nodeSpecs/ports'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'

/**
 * 节点**标题带**的高度（屏幕 px）。
 *
 * `NodeFrame.module.css` 的 `.header` 是 22px 高、挂在节点框**上方**
 * （`bottom: 100%` + `margin-bottom: 2px`）⇒ 节点名与右上角像素读数占掉
 * 节点顶边之上 24px。
 *
 * 为什么要在这里把它记下来：跟随栏的锚点是「节点顶边 − 栏高 − 间距」，
 * 间距只要小于这条带的高度，栏就会**压在节点名上**（用户 2026-10-05：
 * 「功能栏也遮住了节点名称」）。把它抽成常数，栏与标题带的关系就是可断言的。
 */
export const NODE_TITLE_BAND = 24

/**
 * 栏目与节点框的间距（屏幕 px）。
 *
 * 2026-10-05：10 → 30（= 标题带 24 + 6 呼吸）。用户报「功能栏遮住了节点名称」——
 * 原先 10px 的间距让栏底落在标题带**中间**，节点名被压掉一半。
 */
export const FOLLOW_BAR_GAP = NODE_TITLE_BAND + 6
/** 栏高（屏幕 px）：按钮 26 + 内距 4×2 + 描边 1×2 ≈ 36，取整以稳定翻转判定 */
export const FOLLOW_BAR_HEIGHT = 36
/** 首帧尚未测量宽度时的默认估宽（屏幕 px），用于邻节点端点让位判定 */
export const DEFAULT_FOLLOW_BAR_WIDTH = 320
/** 跟随栏避让邻节点端点时的安全间隙（屏幕 px） */
const PORT_AVOID_MARGIN = 6
/** 单次让位的最大上移距离（屏幕 px），防止密集画布下栏飞离节点过远 */
const MAX_PORT_AVOID_LIFT = 120

export interface PortScreenPoint {
  x: number
  y: number
  radius: number
}

export interface FollowBarAnchor {
  /** 栏目水平中心（屏幕 x），由调用方 `translateX(-50%)` 居中使用 */
  centerX: number
  /** 栏目顶边（屏幕 y）：恒为「节点顶边 − 栏高 − 间距」 */
  top: number
}

export function followBarAnchor(rect: Rect, viewport: Viewport): FollowBarAnchor {
  const centerX = (rect.x + rect.w / 2 - viewport.x) * viewport.zoom
  const topEdge = (rect.y - viewport.y) * viewport.zoom
  return { centerX, top: topEdge - FOLLOW_BAR_HEIGHT - FOLLOW_BAR_GAP }
}

/** 收集除当前选中节点外，所有顶层邻节点的端点屏幕圆心与半径（用于 #209 让位）。 */
export function neighborPortPoints(
  graph: GraphSnapshot,
  selectedNodeId: string,
  viewport: Viewport,
): PortScreenPoint[] {
  const zoom = viewport.zoom || 1
  const radius = PORT_SIZE / 2 + 4
  const out: PortScreenPoint[] = []
  for (const node of graph.nodes) {
    if (node.id === selectedNodeId || node.parentId != null) continue
    const spec = getSpec(node.type)
    if (!spec) continue
    const rect = toWorldRectInGraph(node, graph)
    for (const port of portDeclsOf(spec.ports)) {
      const edgeX = port.side === 'left' ? rect.x : rect.x + rect.w
      const worldY = rect.y + rect.h * port.y
      const screenX =
        (edgeX - viewport.x) * zoom + (port.side === 'left' ? -PORT_EDGE_GAP : PORT_EDGE_GAP)
      const screenY = (worldY - viewport.y) * zoom
      out.push({ x: screenX, y: screenY, radius })
    }
  }
  return out
}

/**
 * #209：当跟随栏的屏幕矩形压住任一邻节点端点时，向上让位（保持水平居中且绝不翻到节点下方）。
 * 未碰撞时原样返回，保持零位移。
 */
export function avoidNeighborPorts(
  anchor: FollowBarAnchor,
  barWidth: number,
  neighborPorts: readonly PortScreenPoint[],
): FollowBarAnchor {
  if (neighborPorts.length === 0) return anchor
  const halfW = Math.max(barWidth, 80) / 2
  const left = anchor.centerX - halfW
  const right = anchor.centerX + halfW
  let top = anchor.top
  const minTop = anchor.top - MAX_PORT_AVOID_LIFT

  for (let pass = 0; pass < 3; pass += 1) {
    let nextTop = top
    for (const port of neighborPorts) {
      if (port.x + port.radius <= left || port.x - port.radius >= right) continue
      const portTop = port.y - port.radius
      const portBottom = port.y + port.radius
      if (portBottom <= top || portTop >= top + FOLLOW_BAR_HEIGHT) continue
      const candidate = portTop - FOLLOW_BAR_HEIGHT - PORT_AVOID_MARGIN
      if (candidate < nextTop) nextTop = candidate
    }
    if (nextTop === top) break
    top = Math.max(nextTop, minTop)
    if (top === minTop) break
  }

  return top === anchor.top ? anchor : { centerX: anchor.centerX, top }
}
