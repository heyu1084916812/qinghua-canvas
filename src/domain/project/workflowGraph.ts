/**
 * 工作流**节点图**（对账 #1116 ②）：从 `getJsonApiFormat` 的 `prompt` 里抽出
 * 「有哪些节点、谁连谁」，并按依赖深度自动排布。
 *
 * 为什么单独存一份而不是每次现算：节点图在设置页要**立刻**画出来（用户点进条目就要看），
 * 而原始 workflow JSON 动辄几百 KB —— 存进 `presets` 那条行里既撑存储、也让
 * 「拉一次参数」变得很重。这里只留画图要用的：节点 id / 名字 / 参数 id + 连线。
 */

/**
 * `inputs` 里的「连线值」：`["<上游 nodeId>", 输出槽位号]` —— 它是连接，不是参数。
 *
 * 定义放在**本文件**（而不是 `workflowParams`）是为了让依赖只有一个方向：
 * 字段表与节点图都要用它，谁先定义谁就被两边 import —— 反过来就会domain↔domain 成环。
 * `workflowParams` 原样 re-export 它，历史 import 不用改。
 */
export function isWorkflowLinkValue(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number'
  )
}

export interface WorkflowGraphNode {
  id: string
  /** 显示名：`_meta.title` → `class_type` → 节点号 */
  title: string
  /** ComfyUI 的节点类型（`KSampler` 这类），画在副标题上 */
  classType: string
  /** 这个节点上**可改**的字段 id（`<nodeId>::<fieldName>`），与字段表同一套 id */
  fieldIds: string[]
}

export interface WorkflowGraphEdge {
  from: string
  to: string
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
}

/** 布局尺寸（设计像素；视图里按容器自适应缩放） */
export const GRAPH_NODE_W = 168
export const GRAPH_NODE_H = 56
export const GRAPH_GAP_X = 56
export const GRAPH_GAP_Y = 18

export interface WorkflowGraphLayoutNode {
  id: string
  x: number
  y: number
  /** 列号（0 = 最上游），画分层背景时用得上 */
  depth: number
}

export interface WorkflowGraphLayout {
  width: number
  height: number
  nodes: WorkflowGraphLayoutNode[]
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

/**
 * workflow JSON → 节点图。输入与 `parseWorkflowJsonToFields` 完全一样（`{nodeId: {class_type,_meta,inputs}}`）。
 *
 * 连线判据沿用 `isWorkflowLinkValue`：`inputs` 里的 `["<上游 nodeId>", 槽位]` 是**连接**、
 * 不是参数 —— 两条路共用同一份判据，才不会出现「字段表说没这个参数、图上却画了一条边」。
 */
export function buildWorkflowGraph(workflowJson: unknown): WorkflowGraph {
  if (!workflowJson || typeof workflowJson !== 'object' || Array.isArray(workflowJson)) {
    return { nodes: [], edges: [] }
  }
  const nodes: WorkflowGraphNode[] = []
  const edges: WorkflowGraphEdge[] = []
  const seenEdge = new Set<string>()

  for (const [nodeId, rawNode] of Object.entries(workflowJson as Record<string, unknown>)) {
    if (!rawNode || typeof rawNode !== 'object') continue
    const node = rawNode as { inputs?: unknown; class_type?: unknown; _meta?: unknown }
    const classType = str(node.class_type).trim()
    const meta = node._meta as { title?: unknown } | undefined
    const fieldIds: string[] = []
    const inputs = node.inputs
    if (inputs && typeof inputs === 'object' && !Array.isArray(inputs)) {
      for (const [fieldName, rawValue] of Object.entries(inputs as Record<string, unknown>)) {
        if (isWorkflowLinkValue(rawValue)) {
          const from = str((rawValue as [unknown, unknown])[0]).trim()
          const key = `${from}->${nodeId}`
          if (from && from !== nodeId && !seenEdge.has(key)) {
            seenEdge.add(key)
            edges.push({ from, to: nodeId })
          }
          continue
        }
        fieldIds.push(`${nodeId}::${fieldName}`)
      }
    }
    nodes.push({
      id: nodeId,
      title: str(meta?.title).trim() || classType || nodeId,
      classType,
      fieldIds,
    })
  }

  /** 指向不存在节点的边丢掉：上游 JSON 偶尔有半截节点（被禁用 / 被删） */
  const ids = new Set(nodes.map((node) => node.id))
  return { nodes, edges: edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) }
}

/**
 * 自动布局：**按连线分层**（等价于画布的「整理节点」）。
 *
 * 深度 = 从没有入边的节点出发的最长路径 —— 用最长路径而不是最短，
 * 是为了让「合并前必须两路都到齐」的节点落在两路之后，边不会往回拐。
 * 层内用父节点的平均 y 排序并做两轮重心修正，尽量少交叉。
 * 环（ComfyUI 里确实存在，比如带反馈的迭代节点）不会死循环：松弛最多跑 n 轮。
 */
export type WorkflowGraphDirection = 'lr' | 'tb'

/**
 * @param direction `lr` = 从左到右（ComfyUI 原味）；`tb` = 从上到下。
 *
 * 为什么要两个方向：设置页里那块地方是**竖着比横着富裕**（右侧栏只有三百多像素宽、
 * 却有三百多像素高）。同一张链式图横排要缩到 0.38 才塞得下（节点只剩 60px 宽，字看不清），
 * 竖排却能 1:1 放。视图按「哪个方向缩放更大」自动选，见 `WorkflowGraphView`。
 */
export function layoutWorkflowGraph(
  graph: WorkflowGraph,
  direction: WorkflowGraphDirection = 'lr',
): WorkflowGraphLayout {
  const index = new Map(graph.nodes.map((node, i) => [node.id, i]))
  const parents = new Map<string, string[]>()
  for (const node of graph.nodes) parents.set(node.id, [])
  for (const edge of graph.edges) {
    if (!index.has(edge.from) || !index.has(edge.to)) continue
    parents.get(edge.to)!.push(edge.from)
  }

  const depth = new Map<string, number>()
  for (const node of graph.nodes) depth.set(node.id, 0)
  /** Bellman-Ford 式松弛：节点数有限，最多 n 轮就到不动点（环会在 n 轮内停下） */
  for (let round = 0; round < graph.nodes.length; round += 1) {
    let changed = false
    for (const edge of graph.edges) {
      const from = depth.get(edge.from)
      const to = depth.get(edge.to)
      if (from === undefined || to === undefined) continue
      if (to < from + 1 && from + 1 <= graph.nodes.length) {
        depth.set(edge.to, from + 1)
        changed = true
      }
    }
    if (!changed) break
  }

  const columns = new Map<number, string[]>()
  for (const node of graph.nodes) {
    const d = depth.get(node.id) ?? 0
    const list = columns.get(d) ?? []
    list.push(node.id)
    columns.set(d, list)
  }

  const order = new Map<string, number>()
  for (const list of columns.values()) list.forEach((id, i) => order.set(id, i))
  const along = new Map<string, number>()
  /** 同一列里下一个节点往哪个方向让位：横排让竖直（H+GAP_Y），竖排让水平（W+GAP_X） */
  const crossStep = direction === 'lr' ? GRAPH_NODE_H + GRAPH_GAP_Y : GRAPH_NODE_W + GRAPH_GAP_X
  const place = (column: number) => {
    const list = columns.get(column) ?? []
    list.forEach((id, i) => along.set(id, i * crossStep))
  }
  const depthKeys = [...columns.keys()].sort((a, b) => a - b)
  for (const column of depthKeys) place(column)

  /** 两轮重心修正：层内按父节点平均 y 重排，减少交叉 */
  for (let pass = 0; pass < 2; pass += 1) {
    for (const column of depthKeys) {
      if (column === 0) continue
      const list = columns.get(column)!
      const weight = new Map<string, number>()
      for (const id of list) {
        const ps = parents.get(id) ?? []
        const sum = ps.reduce((acc, pid) => acc + (along.get(pid) ?? 0), 0)
        weight.set(id, ps.length > 0 ? sum / ps.length : (along.get(id) ?? 0))
      }
      const before = new Map(list.map((id, i) => [id, i]))
      list.sort(
        (a, b) =>
          (weight.get(a)! - weight.get(b)!) || (before.get(a)! - before.get(b)!) || ((order.get(a) ?? 0) - (order.get(b) ?? 0)),
      )
      place(column)
    }
  }

  const stepX = GRAPH_NODE_W + GRAPH_GAP_X
  const stepY = GRAPH_NODE_H + GRAPH_GAP_Y
  let maxAlong = 0
  const placed: WorkflowGraphLayoutNode[] = []
  for (const column of depthKeys) {
    for (const id of columns.get(column)!) {
      const offset = along.get(id) ?? 0
      maxAlong = Math.max(maxAlong, offset)
      placed.push({
        id,
        x: direction === 'lr' ? column * stepX : offset,
        y: direction === 'lr' ? offset : column * stepY,
        depth: column,
      })
    }
  }
  const maxDepth = depthKeys.length === 0 ? 0 : depthKeys[depthKeys.length - 1]!
  const crossExtent = placed.length === 0 ? 0 : maxAlong + (direction === 'lr' ? GRAPH_NODE_H : GRAPH_NODE_W)
  const depthExtent = depthKeys.length === 0 ? 0 : maxDepth * (direction === 'lr' ? stepX : stepY) + (direction === 'lr' ? GRAPH_NODE_W : GRAPH_NODE_H)
  return {
    width: direction === 'lr' ? depthExtent : crossExtent,
    height: direction === 'lr' ? crossExtent : depthExtent,
    nodes: placed,
  }
}

/** 输出节点 = 没有出边的节点（取结果的节点；参考实现也用它定「结果类型」） */
export function workflowOutputNodeIds(graph: WorkflowGraph): string[] {
  const hasOut = new Set(graph.edges.map((edge) => edge.from))
  return graph.nodes.filter((node) => !hasOut.has(node.id)).map((node) => node.id)
}

/** 存回来的图 → 干净的图（坏值一律丢弃，不抛） */
export function normalizeWorkflowGraph(raw: unknown): WorkflowGraph | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(record.nodes)) return undefined
  const nodes: WorkflowGraphNode[] = []
  for (const item of record.nodes) {
    if (!item || typeof item !== 'object') continue
    const node = item as Record<string, unknown>
    const id = str(node.id).trim()
    if (!id) continue
    nodes.push({
      id,
      title: str(node.title).trim() || id,
      classType: str(node.classType).trim(),
      /** 字段 id 必须是字符串（`<nodeId>::<fieldName>`）：数字之类一律当脏数据丢掉 */
      fieldIds: Array.isArray(node.fieldIds)
        ? node.fieldIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [],
    })
  }
  if (nodes.length === 0) return undefined
  const ids = new Set(nodes.map((node) => node.id))
  const edges: WorkflowGraphEdge[] = []
  if (Array.isArray(record.edges)) {
    for (const item of record.edges) {
      if (!item || typeof item !== 'object') continue
      const edge = item as Record<string, unknown>
      const from = str(edge.from).trim()
      const to = str(edge.to).trim()
      if (from && to && ids.has(from) && ids.has(to)) edges.push({ from, to })
    }
  }
  return { nodes, edges }
}


/**
 * ComfyUI prompt JSON + 轻画下发的字段三元组 → 可直接交给 `/prompt` 的 graph。
 * 只改已存在的普通 input；连接值（`[nodeId, slot]`）和未知节点/字段保持不动。
 */
export function applyWorkflowNodeInfo(
  workflowJson: unknown,
  values: readonly { nodeId: string; fieldName: string; fieldValue: string }[],
): Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }> {
  if (!workflowJson || typeof workflowJson !== 'object' || Array.isArray(workflowJson)) return {}
  const source = workflowJson as Record<string, unknown>
  const output: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }> = {}
  for (const [nodeId, rawNode] of Object.entries(source)) {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) continue
    const node = rawNode as Record<string, unknown>
    const rawInputs = node.inputs
    const inputs = rawInputs && typeof rawInputs === 'object' && !Array.isArray(rawInputs)
      ? { ...(rawInputs as Record<string, unknown>) }
      : {}
    for (const item of values) {
      if (item.nodeId !== nodeId || !Object.prototype.hasOwnProperty.call(inputs, item.fieldName)) continue
      if (isWorkflowLinkValue(inputs[item.fieldName])) continue
      inputs[item.fieldName] = item.fieldValue
    }
    output[nodeId] = {
      class_type: typeof node.class_type === 'string' ? node.class_type : '',
      inputs,
      ...(node._meta !== undefined ? { _meta: node._meta } : {}),
    }
  }
  return output
}
