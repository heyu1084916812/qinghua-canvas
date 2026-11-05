import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../shared/execution/types'
import { AGENT_CONTEXT_WINDOW, modelMessageWindow } from './modelMessageWindow'

const user = (content: string, hidden = false): ChatMessage => ({
  role: 'user',
  content,
  ...(hidden ? { hiddenFromConversation: true } : {}),
})
const assistant = (content: string, callIds: string[] = []): ChatMessage => ({
  role: 'assistant',
  content,
  ...(callIds.length
    ? { toolCalls: callIds.map((id) => ({ id, name: 'readGraph', args: '{}' })) }
    : {}),
})
const tool = (id: string, content = `结果 ${id}`): ChatMessage => ({
  role: 'tool',
  content,
  toolCallId: id,
  toolName: 'readGraph',
})

function longTask(steps: number): ChatMessage[] {
  const history: ChatMessage[] = [
    { role: 'system', content: '轻量档 system' },
    user('请为「云岚茶」做一整套品牌全案，保留宋韵和青瓷主色'),
    assistant('开始拆解品牌全案'),
  ]
  for (let index = 0; index < steps; index += 1) {
    history.push(assistant('', [`call-${index}`]), tool(`call-${index}`))
  }
  return history
}

describe('modelMessageWindow', () => {
  it('3/20/200 档都固定保留首条有效用户需求，且窗口有界', () => {
    const history = longTask(32)
    for (const size of [3, 20, 200]) {
      const window = modelMessageWindow(history, size)
      expect(window.length).toBeLessThanOrEqual(size)
      expect(window[0]?.content).toContain('云岚茶')
      expect(window.filter((m) => m.role === 'tool').every((message) =>
        window.some((item) => item.toolCalls?.some((call) => call.id === message.toolCallId)),
      )).toBe(true)
      if (size >= 200) expect(window.some((m) => m.role === 'tool')).toBe(true)
      expect(window.filter((m) => m.role === 'system')).toHaveLength(0)
    }
  })

  it('长任务 8/32 步后仍保留原始需求，不把中间整库历史无界塞给模型', () => {
    for (const steps of [8, 32]) {
      const window = modelMessageWindow(longTask(steps), AGENT_CONTEXT_WINDOW)
      expect(window).toContainEqual(expect.objectContaining({ content: expect.stringContaining('云岚茶') }))
      expect(window.length).toBeLessThanOrEqual(AGENT_CONTEXT_WINDOW)
    }
  })

  it('窗口内每个 tool 结果都有同窗口的 assistant tool_call，孤儿结果不会重放', () => {
    const history = [
      user('原始品牌需求'),
      assistant('', ['kept']),
      tool('orphan-before'),
      tool('kept'),
      assistant('阶段完成'),
      ...longTask(12).slice(2),
    ]
    const window = modelMessageWindow(history, 8)
    const callIds = new Set(
      window.flatMap((m) => m.role === 'assistant' ? (m.toolCalls ?? []).map((c) => c.id) : []),
    )
    for (const message of window) {
      if (message.role !== 'tool') continue
      expect(message.toolCallId && callIds.has(message.toolCallId)).toBe(true)
    }
    expect(window.some((m) => m.content === '结果 orphan-before')).toBe(false)
  })

  it('隐藏控制消息不算原始需求，孤立内部 tool 结果不触发付费请求重放', () => {
    const history = [
      user('直接下一步', true),
      assistant('', ['paid-call']),
      tool('paid-call', '{"ok":true,"charged":true}'),
      user('云岚茶品牌全案'),
      assistant('收到'),
    ]
    const window = modelMessageWindow(history, 3)
    expect(window[0]?.content).toBe('云岚茶品牌全案')
    expect(window.some((m) => m.toolCallId === 'paid-call')).toBe(false)
  })

  it('窗口从用户轮边界取尾部消息，不把 assistant(tool_calls) 单独留在开头', () => {
    const window = modelMessageWindow(longTask(10), 6)
    expect(window[0]?.role === 'user' || window[0]?.role === 'assistant' && !window[0]?.toolCalls?.length).toBe(true)
    for (let index = 1; index < window.length; index += 1) {
      if (window[index]?.role !== 'tool') continue
      const callId = window[index]?.toolCallId
      expect(window.slice(0, index).some((m) => m.toolCalls?.some((c) => c.id === callId))).toBe(true)
    }
  })

  it('0 档与坏值不抛错；sessionBrief 只作为一条独立 system 消息由调用方注入', () => {
    expect(modelMessageWindow(longTask(4), 0)).toEqual([])
    expect(modelMessageWindow(longTask(4), -1)).toEqual([])
    expect(modelMessageWindow(longTask(4), Number.NaN)).toEqual([])
  })
})
