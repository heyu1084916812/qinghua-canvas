import type { GraphSnapshot } from '../model/graph'

/**
 * 被某个消费者**排除在本次输入之外**的节点（对账 #1160，用户 2026-11-19 拍板 B1）。
 *
 * 两条来源，都是既有字段，不改数据模型：
 * - `upstreamHidden`：生成 / 提示词节点在面板上把某个**上游**缩略图的眼睛关掉；
 * - `hiddenIds`：谁的眼睛被关了就是谁 ——
 *   · 容器（分组 / 批量）里装的是**子节点**；
 *   · 生成 / 提示词节点里装的是**它自己**（自家素材那枚缩略图被关掉）。
 *
 * ⚠️ 早期版本刻意把"自家素材隐藏"排除在外（担心节点明明还在跑却变灰）。用户
 * 2026-11-19 看图一后纠正：**自家缩略图被隐藏，节点也要跟着置灰** —— 否则面板上
 * 眼睛已经闭上、画布上那张图还是全亮，两处对不上。所以现在三类都算，节点自己的
 * `hiddenIds` 也认。
 *
 * B1 = **任一消费者隐藏即置灰**：多个下游时，只要有一个没在用它，就在画布上标出来，
 * 免得用户以为"它明明在图上，为什么这次没生效"。
 */
export function excludedNodeIds(graph: GraphSnapshot): Set<string> {
  const out = new Set<string>()
  for (const node of graph.nodes) {
    const data = node.data as { hiddenIds?: string[]; upstreamHidden?: string[] }
    for (const id of data.upstreamHidden ?? []) out.add(id)
    for (const id of data.hiddenIds ?? []) out.add(id)
  }
  return out
}
