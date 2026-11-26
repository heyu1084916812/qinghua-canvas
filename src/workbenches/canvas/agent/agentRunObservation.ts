import type { ChatMessage } from '../../../domain/shared/execution/types'

/** 本轮 [start, end) 内已提交运行的节点，包含重跑后的真实承载节点。 */
export function observedRunNodeIds(
  messages: readonly ChatMessage[],
  start: number,
  end: number,
): Set<string> {
  const ran = new Set<string>()
  for (let index = start; index < end; index += 1) {
    const message = messages[index]!
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (call.name !== 'runNode' && call.name !== 'runFrom') continue
        try {
          const args = JSON.parse(call.args || '{}') as { nodeIds?: unknown }
          for (const id of Array.isArray(args.nodeIds) ? args.nodeIds : []) {
            if (typeof id === 'string') ran.add(id)
          }
        } catch {
          // 坏参数不算已运行
        }
      }
      continue
    }
    if (
      message.role !== 'tool' ||
      (message.toolName !== 'runNode' && message.toolName !== 'runFrom')
    ) {
      continue
    }
    try {
      const result = JSON.parse(message.content || '{}') as {
        outcomes?: unknown
      }
      for (const item of Array.isArray(result.outcomes) ? result.outcomes : []) {
        if (!item || typeof item !== 'object') continue
        const row = item as Record<string, unknown>
        if (typeof row.nodeId === 'string') ran.add(row.nodeId)
        for (const id of Array.isArray(row.targetNodeIds)
          ? row.targetNodeIds
          : []) {
          if (typeof id === 'string') ran.add(id)
        }
      }
    } catch {
      // 坏结果不冒充已运行
    }
  }
  return ran
}
