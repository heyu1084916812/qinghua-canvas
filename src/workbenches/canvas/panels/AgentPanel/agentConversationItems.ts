import {
  steerMessagesOf,
  type AgentSteer,
} from '../../../../domain/agent/steering'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import { stripMentionMarkup } from '../../text/MentionEditor'
import { toConversation, type ConversationItem } from './conversation'

/** 建标题表只需要 id / title：图快照与测试造的数据都能直接喂进来。 */
export interface ConversationNodeLike {
  id: string
  title?: string | null
}

/** 产物 hash 只需要 id + `data.assetHash`。 */
export interface AssetHashNodeLike {
  id: string
  data?: unknown
}

/** 节点 id → 显示名；空标题回落「未命名节点」。 */
export function buildNodeTitles(graph: {
  readonly nodes: readonly ConversationNodeLike[]
}): Map<string, string> {
  return new Map(
    graph.nodes.map((node) => [
      node.id,
      node.title?.trim() || '未命名节点',
    ]),
  )
}

export interface ConversationItemsInput {
  messages: readonly ChatMessage[]
  pendingSteers: readonly AgentSteer[]
  nodeTitles?: ReadonlyMap<string, string>
}

/**
 * 对话流条目：历史消息在前，**待发送引导追加在最后**
 * （与它们将来真正进入模型时的先后一致）。
 *
 * 条目怎么折（工具消息 → 步骤卡、过程块怎么并）全在 `conversation.ts`；
 * 这里只固定"喂什么、什么顺序"。
 */
export function buildConversationItems(
  input: ConversationItemsInput,
): ConversationItem[] {
  return toConversation(
    [
      ...input.messages,
      ...steerMessagesOf(input.pendingSteers, stripMentionMarkup),
    ],
    input.nodeTitles,
  )
}

/** 最后一条用户消息的下标；没有就是 -1。 */
export function latestUserIndexOf(
  items: readonly ConversationItem[],
): number {
  return items.reduce(
    (at, item, index) => (item.kind === 'user' ? index : at),
    -1,
  )
}

/** 最后一轮用户消息的开始时间；没有用户消息（或它没有时间）时 undefined。 */
export function latestUserStartedAtOf(
  items: readonly ConversationItem[],
): number | undefined {
  const index = latestUserIndexOf(items)
  const item = index >= 0 ? items[index] : undefined
  return item?.kind === 'user' ? item.createdAt : undefined
}

/** 最后一轮用户消息**之后**的过程块下标；没有就是 -1。 */
export function latestProcessIndexOf(
  items: readonly ConversationItem[],
): number {
  const latestUserIndex = latestUserIndexOf(items)
  return items.reduce(
    (at, item, index) =>
      item.kind === 'process' && index > latestUserIndex ? index : at,
    -1,
  )
}

/** 本轮（最后一条用户消息之后）是否已经出现过过程块。 */
export function currentTurnHasProcessOf(
  items: readonly ConversationItem[],
): boolean {
  return items
    .slice(latestUserIndexOf(items) + 1)
    .some((item) => item.kind === 'process')
}

/** 节点 id → 显示名（步骤卡用）；缺失或空标题回落「素材」。 */
export function nodeLabelOf(
  nodes: readonly ConversationNodeLike[],
  id: string,
): string {
  return (nodes.find((node) => node.id === id)?.title ?? '').trim() || '素材'
}

/**
 * 节点 id → 产物 hash，步骤卡据此把这一步产出的图**内嵌**显示。
 *
 * 这不是缓存，只是把 graph 投影成 Map：同一份 graph 两次调用**值相同、实例不同**。
 * 何时重算由宿主决定（面板把它挂在 `graph` 依赖上）。别在模块里塞 Map 缓存 ——
 * 「图变了但节点对象没换」时就会拿到旧 hash。
 */
export function buildAssetHashByNode(graph: {
  readonly nodes: readonly AssetHashNodeLike[]
}): Map<string, string> {
  const map = new Map<string, string>()
  for (const node of graph.nodes) {
    const data = node.data as { assetHash?: unknown } | undefined
    const hash = data?.assetHash
    if (typeof hash === 'string' && hash) map.set(node.id, hash)
  }
  return map
}
