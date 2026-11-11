import { describe, expect, it } from 'vitest'
import { parseSSELine } from './sse'

describe('OpenAI-compatible SSE parser', () => {
  it('reads public reasoning and content deltas', () => {
    expect(parseSSELine(
      'data: {"choices":[{"delta":{"reasoning_content":"先核对参考图"}}]}',
    )).toEqual({
      type: 'delta',
      reasoning: '先核对参考图',
    })
    expect(parseSSELine(
      'data: {"choices":[{"delta":{"content":"正在生成计划"}}]}',
    )).toEqual({
      type: 'delta',
      text: '正在生成计划',
    })
  })

  it('preserves fragmented tool-call argument strings', () => {
    expect(parseSSELine(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"applyPlan","arguments":"{\\"name\\":"}}]}}]}',
    )).toMatchObject({
      type: 'tool_call',
      toolCallDeltas: [{
        index: 0,
        id: 'call_1',
        name: 'applyPlan',
        arguments: '{"name":',
      }],
    })
  })

  it('keeps the existing internal event contract and done marker', () => {
    expect(parseSSELine('data: {"type":"delta","text":"你好"}')).toEqual({
      type: 'delta',
      text: '你好',
    })
    expect(parseSSELine('data: [DONE]')).toEqual({ type: 'done' })
  })

  it('ignores role-only and finish-only metadata chunks', () => {
    expect(parseSSELine(
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    )).toBeNull()
    expect(parseSSELine(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
    )).toBeNull()
  })

  it('accepts a full chat-completion JSON response from a gateway that ignored stream=true', () => {
    expect(parseSSELine(JSON.stringify({
      choices: [{
        message: {
          content: '完整回复',
          reasoning_content: '核对完成',
          tool_calls: [{
            id: 'call_full',
            function: { name: 'applyPlan', arguments: '{"nodes":[]}' },
          }],
        },
      }],
    }))).toEqual({
      type: 'delta',
      text: '完整回复',
      reasoning: '核对完成',
      toolCallDeltas: [{
        index: 0,
        id: 'call_full',
        name: 'applyPlan',
        arguments: '{"nodes":[]}',
      }],
    })
  })

  it('turns an HTTP-200 error payload into an explicit error chunk', () => {
    expect(parseSSELine(
      'data: {"error":{"message":"upstream overloaded"}}',
    )).toMatchObject({
      type: 'error',
      error: { kind: 'http', status: 502, body: 'upstream overloaded' },
    })
  })

  it('ignores the trailing usage-only chunk instead of leaking it as reply text (65535)', () => {
    expect(parseSSELine(
      'data: {"choices":[],"id":"chatcmpl-1","model":"gemini-3.8-flash","object":"chat.completion.chunk","usage":{"completion_tokens":21,"prompt_tokens":35,"total_tokens":56}}',
    )).toBeNull()
    expect(parseSSELine(
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","usage":{"total_tokens":3}}',
    )).toBeNull()
  })
})
