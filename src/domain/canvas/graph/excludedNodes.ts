import type { GraphSnapshot } from '../model/graph'

/**
 * 被某个消费者**排除在本次输入之外**的节点（对账 #1160，用户 2026-11-19 拍板 B1）。
 *
 * 两条来源，都是既有字段，不改数据模型：
 * - `upstreamHidden`：生成 / 提示词节点在面板上把某个**上游**缩略图的眼睛关掉；
 * - `hiddenIds`：**容器**（分组 / 批量）把某个子节点关掉。
 *
 * ⚠️ 生成 / 提示词节点自己的 `hiddenIds` 里存的是**它自己**（自己的素材被隐藏），
 * 那只是"这次不把它自己的素材当输入"，节点本身照常跑、照常有产物 —— 所以这里
 * **只认容器**的 `hiddenIds`，别把自家素材隐藏误判成"整个节点没参与"。
 *
 * B1 = **任一消费者隐藏即置灰**：多个下游时，只要有一个没在用它，就在画布上标出来，
 * 免得用户以为"它明明在图上，为什么这次没生效"。
 */
export function excludedNodeIds(graph: GraphSnapshot): Set<string> {
  const out = new Set<string>()
  for (const node of graph.nodes) {
    const data = node.data as { hiddenIds?: string[]; upstreamHidden?: string[] }
    for (const id of data.upstreamHidden ?? []) out.add(id)
    if (node.type !== 'group' && node.type !== 'batch') continue
    for (const id of data.hiddenIds ?? []) out.add(id)
  }
  return out
}
