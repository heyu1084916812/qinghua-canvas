import type { GraphSnapshot } from '../model/graph'

/**
 * 被某个消费者**排除在本次输入之外**的节点（对账 #1160「未参与」置灰）。
 *
 * 三个来源（既有字段，不改数据模型）：`upstreamHidden`＝下游关掉某个上游的眼睛；
 * 容器（分组 / 批量）`hiddenIds`＝关掉某个子节点；生成 / 提示词节点 `hiddenIds`＝关掉**自家素材**。
 *
 * ⚠️ 只认"界面上确实还有那只眼睛"的条目（用户 2026-11-19 第五、六轮："隐藏都关掉了，
 * 节点上的图还是没恢复"）。历史数据里会留悬空 / 张冠李戴的 id —— 实测 `小猫钓鱼-02` 事故：
 * 承载节点（`__carrierOf`，执行落位产物）的 `hiddenIds` 装的是**它的源节点 id**，
 * 两者之间连边都没有；旧口径把源节点永久置灰，而源节点自己面板里那只眼睛却显示"已启用"。
 * 故逐条校验：上游仍连着 / 仍是该容器子节点 / 等于自己且还有 `assetHash`；别人的 id 一律不算。
 */
export function excludedNodeIds(graph: GraphSnapshot): Set<string> {
  const parentOf = new Map<string, string | null>()
  for (const node of graph.nodes) parentOf.set(node.id, node.parentId ?? null)
  const upstreamsOf = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    const set = upstreamsOf.get(edge.target) ?? new Set<string>()
    set.add(edge.source)
    upstreamsOf.set(edge.target, set)
  }

  const out = new Set<string>()
  for (const node of graph.nodes) {
    const data = node.data as { hiddenIds?: string[]; upstreamHidden?: string[]; assetHash?: string }
    const upstreams = upstreamsOf.get(node.id)
    for (const id of data.upstreamHidden ?? []) {
      if (upstreams?.has(id)) out.add(id)
    }
    if (node.type === 'group' || node.type === 'batch') {
      for (const id of data.hiddenIds ?? []) {
        if (parentOf.get(id) === node.id) out.add(id)
      }
      continue
    }
    /* 自家素材：只有"确实还有素材"时，那枚眼睛才存在，隐藏才算数 */
    if (data.assetHash && (data.hiddenIds ?? []).includes(node.id)) out.add(node.id)
  }
  return out
}
