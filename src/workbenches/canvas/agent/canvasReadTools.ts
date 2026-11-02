import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { describeError, type AppError } from '../../../shared/result'

/** 画布现状摘要 —— 结构与设计文档 §4.2 的回填格式一致 */
export interface GraphSummary {
  /**
   * 兼容旧测试 / 旧会话里只含 nodes + edges 的摘要。`readGraph` 的运行时结果
   * 始终会带这些空间字段；这里保持可选，避免读旧历史时整段摘要失效。
   */
  bounds?: { x: number; y: number; w: number; h: number }
  nodes: {
    id: string
    type: string
    title: string
    hasOutput: boolean
    x?: number
    y?: number
    w?: number
    h?: number
    center?: { x: number; y: number }
    parentId?: string
    parentTitle?: string
    /** 在整张画布九个区域中的位置，例如「左上」「中部」「右下」。 */
    zone?: string
    /** 最近 4 个节点；distance 为矩形中心之间的欧氏距离。 */
    nearby?: {
      nodeId: string
      title: string
      direction: string
      distance: number
    }[]
    upstream?: string[]
    downstream?: string[]
    /**
     * 节点上的**正文**（生成 / 批量 / 分组是 `data.prompt`，提示词节点是 `data.text`），
     * 最多 160 字。
     *
     * 用户 2026-10-05 第六批：「我让他换成 3d 风格，但是他前面给我加了前置词小猫钓鱼，
     * 结果把内容也给我换成小猫去了，本来应该是只换成 3d 风格的」—— 根因就是**摘要里没有正文**：
     * 模型手上只有 `title`（「小猫钓鱼」），要写提示词时只能拿它当内容，
     * 于是「换风格」变成了「画一只钓鱼的小猫」。给它正文，它才可能「保留内容、只换风格」。
     */
    prompt?: string
    /**
     * 这个节点是**分发器**（批量 / 循环）时，产物的承载节点 id。
     *
     * 「有没有出图」不能只看它自己的 `assetHash` —— 展开出来的后续几次落在承载节点上。
     */
    carrierNodeIds?: string[]
  }[]
  edges: {
    id?: string
    source: string
    target: string
    sourcePort: string
    targetPort: string
  }[]
}

export const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

export const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

function centerOf(node: { x: number; y: number; w: number; h: number }) {
  return { x: node.x + node.w / 2, y: node.y + node.h / 2 }
}

function directionBetween(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  if (horizontal) return dx < 0 ? '左' : '右'
  return dy < 0 ? '上' : '下'
}

function zoneOf(
  center: { x: number; y: number },
  bounds: { x: number; y: number; w: number; h: number },
): string {
  if (bounds.w <= 0 || bounds.h <= 0) return '未知'
  const px = (center.x - bounds.x) / bounds.w
  const py = (center.y - bounds.y) / bounds.h
  const horizontal = px < 1 / 3 ? '左' : px > 2 / 3 ? '右' : ''
  const vertical = py < 1 / 3 ? '上' : py > 2 / 3 ? '下' : ''
  if (!horizontal && !vertical) return '中部'
  return `${horizontal}${vertical}` || '中部'
}

export function summarizeGraph(
  graph: Pick<GraphSnapshot, 'nodes' | 'edges'>,
  selectedIds?: readonly string[],
): GraphSummary {
  // 选中项由调用方给：画布 store 只暴露图快照，选中态在视图层
  const only = selectedIds ? new Set(selectedIds) : null
  const bounds =
    graph.nodes.length > 0
      ? {
          x: Math.min(...graph.nodes.map((node) => node.x)),
          y: Math.min(...graph.nodes.map((node) => node.y)),
          w:
            Math.max(...graph.nodes.map((node) => node.x + node.w)) -
            Math.min(...graph.nodes.map((node) => node.x)),
          h:
            Math.max(...graph.nodes.map((node) => node.y + node.h)) -
            Math.min(...graph.nodes.map((node) => node.y)),
        }
      : { x: 0, y: 0, w: 0, h: 0 }
  const nodeTitles = new Map(graph.nodes.map((node) => [node.id, node.title] as const))
  /**
   * 产出过图的**承载节点**：批量 / 循环展开时除第一次之外的产物落在它们身上
   * （见 `canvasPlacement` 的 `__carrierOf`）。
   *
   * 没有这一步，摘要会对着一个「跑出 5 张图的批量节点」说 `hasOutput: false` ——
   * agent 于是以为没出图，重复提交（用户 2026-10-16 报的就是这类判断错）。
   */
  const carriersByOwner = new Map<string, string[]>()
  for (const n of graph.nodes) {
    const owner = asRecord(n.data).__carrierOf
    if (typeof owner !== 'string') continue
    const list = carriersByOwner.get(owner) ?? []
    list.push(n.id)
    carriersByOwner.set(owner, list)
  }
  const nodes = graph.nodes
    .filter((n) => !only || only.has(n.id))
    .map((n) => {
      const data = asRecord(n.data)
      const text = typeof data.prompt === 'string' ? data.prompt : data.text
      const prompt = typeof text === 'string' ? text.trim().slice(0, 160) : ''
      const carrierIds = carriersByOwner.get(n.id) ?? []
      const center = centerOf(n)
      const nearby = graph.nodes
        .filter((other) => other.id !== n.id)
        .map((other) => {
          const otherCenter = centerOf(other)
          return {
            nodeId: other.id,
            title: other.title,
            direction: directionBetween(center, otherCenter),
            distance: Math.round(Math.hypot(otherCenter.x - center.x, otherCenter.y - center.y)),
          }
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4)
      const upstream = graph.edges.filter((edge) => edge.target === n.id).map((edge) => edge.source)
      const downstream = graph.edges
        .filter((edge) => edge.source === n.id)
        .map((edge) => edge.target)
      return {
        id: n.id,
        type: n.type,
        title: n.title,
        x: Math.round(n.x),
        y: Math.round(n.y),
        w: Math.round(n.w),
        h: Math.round(n.h),
        center: { x: Math.round(center.x), y: Math.round(center.y) },
        ...(n.parentId
          ? { parentId: n.parentId, parentTitle: nodeTitles.get(n.parentId) ?? n.parentId }
          : {}),
        zone: zoneOf(center, bounds),
        nearby,
        upstream,
        downstream,
        hasOutput:
          typeof data.assetHash === 'string' ||
          carrierIds.some((cid) => {
            const carrier = graph.nodes.find((x) => x.id === cid)
            return carrier ? typeof asRecord(carrier.data).assetHash === 'string' : false
          }),
        ...(carrierIds.length > 0 ? { carrierNodeIds: carrierIds } : {}),
        ...(prompt ? { prompt } : {}),
      }
    })
  const ids = new Set(nodes.map((n) => n.id))
  return {
    bounds: {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      w: Math.round(bounds.w),
      h: Math.round(bounds.h),
    },
    nodes,
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourcePort: e.sourcePort ?? 'output',
        targetPort: e.targetPort ?? 'input',
      })),
  }
}

export function readGraphSummary(
  store: CanvasStore,
  scope: unknown,
  selectedIds: readonly string[] = [],
): GraphSummary {
  return summarizeGraph(store.getSnapshot(), scope === 'selection' ? selectedIds : undefined)
}

/**
 * 素材信息。
 *
 * 尺寸只报**节点记录下来的**真实像素（`naturalSize`）：节点没记就说不知道，
 * 不去猜、也不为它去解码字节 —— agent 问它是为了判断「能不能当参考图」，
 * 一个编出来的尺寸会直接导致它做出错误判断。
 */
type NodeLike = { type: string; data: unknown } | undefined

function assetMimeOf(node: NodeLike): string {
  if (!node) return 'unknown'
  const data = asRecord(node.data)
  const mime = data.assetMime
  if (typeof mime === 'string' && mime.trim()) return mime
  if (node.type === 'generation' || node.type === 'batch') {
    return data.mode === 'video' ? 'video/mp4' : 'image/png'
  }
  return 'unknown'
}

export function readAssetInfo(store: CanvasStore, nodeIds: unknown) {
  const graph = store.getSnapshot()
  const out: { nodeId: string; title?: string; mime: string; width?: number; height?: number }[] = []
  for (const id of asStringArray(nodeIds)) {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) {
      out.push({ nodeId: id, mime: 'unknown' })
      continue
    }
    const data = asRecord(node.data)
    const title = (node.title ?? '').trim()
    const size = asRecord(data.naturalSize)
    const w = typeof size.width === 'number' ? size.width : undefined
    const h = typeof size.height === 'number' ? size.height : undefined
    out.push({
      nodeId: id,
      ...(title ? { title } : {}),
      mime: assetMimeOf(node),
      ...(w && h ? { width: w, height: h } : {}),
    })
  }
  return out
}

/**
 * 产物与状态。
 *
 * 数据源是**节点自己记着的产物字段**（画布上显示的就是它），不是执行留痕表 ——
 * agent 关心的是「这个节点现在有什么」，而不是「历史上跑过几次」。
 */
export function readResults(
  store: CanvasStore,
  nodeIds: unknown,
  nodeRunStateOf?: (
    nodeId: string,
  ) => { kind: 'failed'; error?: AppError; reason?: string } | undefined,
) {
  const graph = store.getSnapshot()
  /**
   * **承载节点**：批量 / 循环展开时，除第一次之外的产物落在**新建的承载节点**上，
   * 它们带着 `data.__carrierOf = <源节点 id>`（见 `canvasPlacement` 的说明）。
   *
   * 用户 2026-10-16 报的「执行明明出了图，已读结果却说没留下记录」就是漏了这一步：
   * 只看被问的那个节点自己的 `assetHash`，批量跑出来的后续几次全都看不见。
   */
  const carriersOf = new Map<string, string[]>()
  for (const n of graph.nodes) {
    const owner = asRecord(n.data).__carrierOf
    if (typeof owner !== 'string') continue
    const list = carriersOf.get(owner) ?? []
    list.push(n.id)
    carriersOf.set(owner, list)
  }
  return asStringArray(nodeIds).map((id) => {
    const node = graph.nodes.find((n) => n.id === id)
    if (!node) return { nodeId: id, status: 'missing' as const }
    const title = (node.title ?? '').trim()
    const own = asRecord(node.data).assetHash
    const carrierIds = carriersOf.get(id) ?? []
    const hashes: string[] = []
    if (typeof own === 'string') hashes.push(own)
    for (const carrierId of carrierIds) {
      const carrier = graph.nodes.find((n) => n.id === carrierId)
      const hash = carrier ? asRecord(carrier.data).assetHash : undefined
      if (typeof hash === 'string') hashes.push(hash)
    }
    const state = nodeRunStateOf?.(id)
    const failedReason =
      state?.kind === 'failed'
        ? state.reason ?? (state.error ? describeError(state.error) : undefined)
        : undefined
    if (failedReason) {
      return {
        nodeId: id,
        ...(title ? { title } : {}),
        status: 'failed' as const,
        reason: failedReason,
        ...(hashes.length > 0
          ? {
              outputs: hashes.map((hash) => ({
                hash,
                mime: assetMimeOf(
                  hash === own
                    ? node
                    : graph.nodes.find(
                        (carrier) => asRecord(carrier.data).assetHash === hash,
                      ),
                ),
              })),
              note: '这些是之前成功留下的产物，不是最近一次失败运行的新结果。',
            }
          : {}),
      }
    }
    return hashes.length > 0
      ? {
          nodeId: id,
          ...(title ? { title } : {}),
          status: 'ok' as const,
          outputs: hashes.map((hash) => ({
            hash,
            mime: assetMimeOf(
              hash === own
                ? node
                : graph.nodes.find(
                    (carrier) => asRecord(carrier.data).assetHash === hash,
                  ),
            ),
          })),
          /** 产物散在哪些节点上 —— 模型据此知道该去改哪一张，而不是再来问一遍 */
          ...(carrierIds.length > 0 ? { carrierNodeIds: carrierIds } : {}),
        }
      : {
          nodeId: id,
          ...(title ? { title } : {}),
          status: 'empty' as const,
          /**
           * 「这个节点自己是空的」**不等于**「这次没有出图」：批量 / 循环的产物可能全在
           * 承载节点上（它们此刻也还没图，或者已经被用户挪走）。把这句话带给模型，
           * 免得它把「源节点空」直接读成「没出图」再重复提交一次。
           */
          ...(carrierIds.length > 0
            ? { note: '该节点是分发器（批量/循环），产物在承载节点上', carrierNodeIds: carrierIds }
            : {}),
        }
  })
}
