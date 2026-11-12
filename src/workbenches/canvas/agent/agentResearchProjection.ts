import type { ChatMessage } from '../../../domain/shared/execution/types'

/**
 * 图片模式调研（G-R1，对齐 Lovart）：结果卡已经展示给用户，模型只拿一句摘要。
 *
 * - 持久化的 tool 消息保持原样（画廊靠它渲染），这里只改**发给模型**的投影；
 * - 图片模式成功且有结果时才投影；失败 / 0 条 / 网页 / 混合模式保持完整结果，模型据此如实说明；
 * - 本轮最后一批工具只有图片调研且成功时，模型的收尾正文不进对话（Lovart 图片模式没有文字回复）。
 */
interface ImageResearchFacts {
  totalItems: number
  hosts: string[]
}

function hostOf(url: unknown): string {
  try {
    return typeof url === 'string' ? new URL(url).hostname.replace(/^www\./, '') : ''
  } catch {
    return ''
  }
}

/** 解析一条 researchDesign 结果；只有「图片模式、ok、至少一张图」返回事实，否则 null。 */
export function imageResearchFactsOf(message: ChatMessage): ImageResearchFacts | null {
  if (message.role !== 'tool' || message.toolName !== 'researchDesign') return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(message.content || '{}') as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || parsed.ok === false) return null
  const request = (parsed.request ?? {}) as Record<string, unknown>
  const mode = parsed.mode ?? request.mode
  if (mode !== 'image') return null
  const items = Array.isArray(parsed.items) ? parsed.items as Record<string, unknown>[] : []
  const images = items.filter((item) => typeof item?.imageUrl === 'string' && item.imageUrl.length > 0)
  if (images.length === 0) return null
  const hosts = [...new Set(images.map((item) => hostOf(item.url)).filter(Boolean))]
  return { totalItems: images.length, hosts }
}

export function imageResearchSummary(facts: ImageResearchFacts): string {
  const from = facts.hosts.length > 0 ? `（来自 ${facts.hosts.slice(0, 4).join('、')}${facts.hosts.length > 4 ? ' 等' : ''}）` : ''
  return `已找到 ${facts.totalItems} 张参考图${from}，已作为「查看图片搜索结果」卡片展示给用户。`
}

/** 发给模型前的投影：图片调研结果换成一句摘要 + 不要复述的约束。 */
export function projectToolMessageForModel(message: ChatMessage): ChatMessage {
  const facts = imageResearchFactsOf(message)
  if (!facts) return message
  return {
    ...message,
    content: JSON.stringify({
      ok: true,
      mode: 'image',
      totalItems: facts.totalItems,
      shownToUser: true,
      summary: imageResearchSummary(facts),
      note: '不要逐条复述标题、链接或做分析；用户只要找图时本轮不写正文，直接结束。用户勾选并发送后才会进入参考。',
    }),
  }
}

/**
 * 本轮最后一批工具调用是否「只有图片调研且至少一次成功」。是则模型的收尾正文不展示
 * （结果卡就是回答）；还有其它工具、或调研失败 / 无图时照常展示。
 */
export function lastBatchWasImageResearch(messages: readonly ChatMessage[]): boolean {
  let index = messages.length - 1
  const results: ChatMessage[] = []
  while (index >= 0 && messages[index]!.role === 'tool') {
    results.push(messages[index]!)
    index -= 1
  }
  const batch = messages[index]
  if (!batch || batch.role !== 'assistant' || !batch.toolCalls?.length) return false
  if (!batch.toolCalls.every((call) => call.name === 'researchDesign')) return false
  return results.some((message) => imageResearchFactsOf(message) !== null)
}
