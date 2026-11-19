import type { GraphSnapshot } from '../model/graph'

/**
 * 被某个消费者**排除在本次输入之外**的节点（对账 #1160，用户 2026-11-19 拍板 B1）。
 *
 * 两条来源，都是既有字段，不改数据模型：
 * - `upstreamHidden`：生成 / 提示词节点在面板上把某个**上游**缩略图的眼睛关掉；
 * - `hiddenIds`：谁的眼睛被关掉就是谁 ——
 *   · 容器（分组 / 批量）里装的是**子节点**；
 *   · 生成 / 提示词节点里装的是**它自己**（自家素材那枚缩略图被关掉）。
 *
 * 三类都算（用户 2026-11-19 最终口径）：
 * 1. 上游被下游关掉眼睛 ⇒ 上游置灰；
 * 2. 容器里某个子节点被关掉 ⇒ 该子节点置灰；
 * 3. **自家素材被关掉 ⇒ 节点自己也置灰**（眼睛闭上时画布上那张图必须跟着灰，
 *    否则面板与画布对不上）；**再把眼睛打开必须立刻恢复**（见 `hiddenIds` 的写入方式：
 *    每次切换都写一份新数组 → 图内容变化 → `excluded` 重新推导 → 节点重渲染）。
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
