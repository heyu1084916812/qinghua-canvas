import type { GraphSnapshot } from '../model/graph'

/**
 * 被某个消费者**排除在本次输入之外**的节点（对账 #1160，用户 2026-11-19 拍板 B1）。
 *
 * 两条来源，都是既有字段，不改数据模型：
 * - `upstreamHidden`：生成 / 提示词节点在面板上把某个**上游**缩略图的眼睛关掉；
 * - `hiddenIds`：**容器**（分组 / 批量）把某个子节点关掉。
 *
 * ⚠️ **自家素材被隐藏不算「未参与」**（用户 2026-11-19 看图一后定稿）：
 * 生成 / 提示词节点自己的 `hiddenIds` 里存的是**它自己** —— 那只是"这次不拿自己的素材
 * 当输入"，节点照常跑、照常出图。把它标成「未参与」会让用户以为这个节点没参与本次生成，
 * 而它的产物明明还在。上一版试过三类都算，用户立刻指出了这一点，已回退。
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
