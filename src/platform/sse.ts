import type { StreamChunk } from './ports'

/**
 * SSE 解析：web 与 memory 两个实现共用，便于脱离浏览器测试。
 * 协议：每行 `data: <payload>`；`[DONE]` 表示结束。
 * payload 为 JSON 且含 type 字段时按 StreamChunk 解析，否则当作一段 delta 文本。
 */
export function parseSSELine(line: string): StreamChunk | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  /**
   * Most providers send SSE `data:` lines. Some OpenAI-compatible gateways
   * ignore `stream:true` and return one JSON document instead. Accept that
   * shape too, so we can use the already-paid response without resending it.
   */
  const payload = trimmed.startsWith('data:')
    ? trimmed.slice(5).trim()
    : trimmed.startsWith('{')
      ? trimmed
      : ''
  if (!payload) return null
  if (payload === '[DONE]') return { type: 'done' }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    if (parsed.error && typeof parsed.error === 'object') {
      const error = parsed.error as Record<string, unknown>
      return {
        type: 'error',
        error: {
          kind: 'http',
          status: 502,
          body: typeof error.message === 'string' ? error.message : payload.slice(0, 500),
        },
      }
    }
    if (typeof parsed.type === 'string') {
      return {
        type: parsed.type as StreamChunk['type'],
        ...(typeof parsed.text === 'string' ? { text: parsed.text } : {}),
        ...(typeof parsed.reasoning === 'string' ? { reasoning: parsed.reasoning } : {}),
        ...(parsed.toolCall ? { toolCall: parsed.toolCall as StreamChunk['toolCall'] } : {}),
      }
    }

    /**
     * OpenAI-compatible chat streams do not use our internal `type` field.
     * Their first meaningful payload is `choices[0].delta`; treating the
     * whole JSON as visible text is what made every token look like a JSON
     * object in the old process timeline.
     */
    const choices = Array.isArray(parsed.choices) ? parsed.choices : []
    const first = choices[0] && typeof choices[0] === 'object'
      ? (choices[0] as Record<string, unknown>)
      : undefined
    const delta = first?.delta && typeof first.delta === 'object'
      ? (first.delta as Record<string, unknown>)
      : undefined
    if (delta) {
      const reasoning = [
        delta.reasoning_content,
        delta.reasoning,
        delta.thinking,
        delta.analysis,
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('')
      const text = typeof delta.content === 'string' ? delta.content : ''
      const rawCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : []
      const toolCalls = rawCalls.flatMap((value, fallbackIndex) => {
        if (!value || typeof value !== 'object') return []
        const row = value as Record<string, unknown>
        const fn = row.function && typeof row.function === 'object'
          ? (row.function as Record<string, unknown>)
          : {}
        const index = typeof row.index === 'number' ? row.index : fallbackIndex
        const id = typeof row.id === 'string' && row.id ? row.id : undefined
        const name = typeof fn.name === 'string' && fn.name ? fn.name : undefined
        const args = typeof fn.arguments === 'string' ? fn.arguments : undefined
        return [{ index, ...(id ? { id } : {}), ...(name ? { name } : {}), ...(args ? { arguments: args } : {}) }]
      })
      if (reasoning || text || toolCalls.length > 0) {
        return {
          type: toolCalls.length > 0 && !text && !reasoning ? 'tool_call' : 'delta',
          ...(text ? { text } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(toolCalls.length > 0 ? { toolCallDeltas: toolCalls } : {}),
        }
      }
      // Role-only and finish-only chunks are protocol metadata, not visible text.
      return null
    }
    const message = first?.message && typeof first.message === 'object'
      ? (first.message as Record<string, unknown>)
      : undefined
    if (message) {
      const reasoning = [
        message.reasoning_content,
        message.reasoning,
        message.thinking,
        message.analysis,
      ]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('')
      const text = typeof message.content === 'string' ? message.content : ''
      const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      const toolCalls = rawCalls.flatMap((value, index) => {
        if (!value || typeof value !== 'object') return []
        const row = value as Record<string, unknown>
        const fn = row.function && typeof row.function === 'object'
          ? (row.function as Record<string, unknown>)
          : {}
        return [{
          index,
          ...(typeof row.id === 'string' && row.id ? { id: row.id } : {}),
          ...(typeof fn.name === 'string' && fn.name ? { name: fn.name } : {}),
          ...(typeof fn.arguments === 'string' ? { arguments: fn.arguments } : {}),
        }]
      })
      return {
        type: toolCalls.length > 0 && !text && !reasoning ? 'tool_call' : 'delta',
        ...(text ? { text } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(toolCalls.length > 0 ? { toolCallDeltas: toolCalls } : {}),
      }
    }
    return { type: 'delta', text: payload }
  } catch {
    return { type: 'delta', text: payload }
  }
}

/** 把可能跨 chunk 截断的字节流切成完整行 */
export function createLineSplitter(): (chunk: string) => string[] {
  let buffer = ''
  return (chunk: string): string[] => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    return lines
  }
}
