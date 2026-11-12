import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import { runAgentTurn } from './agentLoop'
import {
  imageResearchFactsOf,
  lastBatchWasImageResearch,
  projectToolMessageForModel,
} from './agentResearchProjection'
import { AGENT_TOOLS } from './tools'

const imageReport = (count: number, mode: 'image' | 'web' | 'mixed' = 'image') => ({
  ok: true,
  request: { topic: '咖啡海报', mode },
  items: Array.from({ length: count }, (_, index) => ({
    id: `bing:${index}`,
    source: 'bing',
    title: `咖啡海报 ${index}`,
    url: index % 2 ? `https://www.behance.net/gallery/${index}` : `https://www.pinterest.com/pin/${index}/`,
    imageUrl: `https://img.example.com/${index}.jpg`,
    description: '很长的描述'.repeat(20),
  })),
  sources: [],
  moodboard: [],
  rightsNote: '版权提示',
  warnings: [],
  totalItems: count,
})

const toolMessage = (value: unknown, id = 'r1'): ChatMessage => ({
  role: 'tool',
  toolCallId: id,
  toolName: 'researchDesign',
  content: JSON.stringify(value),
})

describe('G-R1 image research projection', () => {
  it('replaces a successful image-mode result with a one-sentence summary for the model', () => {
    const original = toolMessage(imageReport(40))
    const projected = projectToolMessageForModel(original)
    const body = JSON.parse(projected.content) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true, mode: 'image', totalItems: 40, shownToUser: true })
    expect(String(body.summary)).toBe(
      '已找到 40 张参考图（来自 pinterest.com、behance.net），已作为「查看图片搜索结果」卡片展示给用户。',
    )
    expect(projected.content).not.toContain('https://')
    expect(projected.content.length).toBeLessThan(original.content.length / 10)
    // 落盘消息不被改写（画廊靠它渲染）。
    expect(original.content).toContain('https://img.example.com/0.jpg')
  })

  it('keeps web / mixed / failed / empty results untouched', () => {
    for (const value of [
      imageReport(5, 'web'),
      imageReport(5, 'mixed'),
      { ...imageReport(5), ok: false },
      imageReport(0),
    ]) {
      const message = toolMessage(value)
      expect(projectToolMessageForModel(message)).toBe(message)
      expect(imageResearchFactsOf(message)).toBeNull()
    }
    const other: ChatMessage = { role: 'tool', toolName: 'readGraph', toolCallId: 'x', content: '{}' }
    expect(projectToolMessageForModel(other)).toBe(other)
  })

  it('detects a last batch made only of successful image research', () => {
    const call = (name: string, id: string) => ({ id, name, args: '{}' })
    const base: ChatMessage[] = [{ role: 'user', content: '找咖啡海报参考图' }]
    expect(lastBatchWasImageResearch([
      ...base,
      { role: 'assistant', content: '', toolCalls: [call('researchDesign', 'r1')] },
      toolMessage(imageReport(3)),
    ])).toBe(true)
    expect(lastBatchWasImageResearch([
      ...base,
      { role: 'assistant', content: '', toolCalls: [call('researchDesign', 'r1'), call('readGraph', 'g')] },
      toolMessage(imageReport(3)),
      { role: 'tool', toolCallId: 'g', toolName: 'readGraph', content: '{}' },
    ])).toBe(false)
    expect(lastBatchWasImageResearch([
      ...base,
      { role: 'assistant', content: '', toolCalls: [call('researchDesign', 'r1')] },
      toolMessage(imageReport(0)),
    ])).toBe(false)
    expect(lastBatchWasImageResearch(base)).toBe(false)
  })
})

describe('G-R1 runAgentTurn: image research has no prose reply', () => {
  function deps(replies: { text?: string; toolCalls?: { id: string; name: string; args: string }[] }[], report: unknown) {
    let index = 0
    const seen: ChatMessage[][] = []
    const adapter = {
      completeText: vi.fn(async (request: { messages?: ChatMessage[] }) => {
        seen.push(request.messages ?? [])
        const reply = replies[Math.min(index++, replies.length - 1)]!
        return { text: reply.text ?? '', ...(reply.toolCalls ? { toolCalls: reply.toolCalls } : {}) }
      }),
    }
    return {
      seen,
      deps: {
        adapter,
        channelId: 'c',
        model: 'm',
        tools: AGENT_TOOLS,
        executeRead: vi.fn(async () => report),
        executeWrite: vi.fn(async () => ({ ok: true })),
        signal: new AbortController().signal,
      },
    }
  }

  it('drops the closing prose after a successful image search and sends the model only the summary', async () => {
    const { deps: d, seen } = deps([
      { toolCalls: [{ id: 'r1', name: 'researchDesign', args: '{"topic":"咖啡海报","mode":"image"}' }] },
      { text: '1. 咖啡海报 0 https://www.pinterest.com/pin/0/ …（长篇复述）' },
    ], imageReport(40))
    const result = await runAgentTurn([{ role: 'user', content: '帮我找一些咖啡海报的参考图片' }], d)
    expect(result.kind).toBe('message')
    if (result.kind !== 'message') return
    expect(result.text).toBe('')
    expect(result.messages.at(-1)).toMatchObject({ role: 'assistant', content: '' })
    // 落盘的 tool 消息仍是完整结果。
    const stored = result.messages.find((message) => message.role === 'tool')
    expect(stored?.content).toContain('https://img.example.com/39.jpg')
    // 第二次请求模型时看到的是摘要。
    const sentTool = seen[1]?.find((message) => message.role === 'tool')
    expect(sentTool?.content).toContain('已找到 40 张参考图')
    expect(sentTool?.content).not.toContain('img.example.com')
  })

  it('keeps the reply when the image search found nothing', async () => {
    const { deps: d } = deps([
      { toolCalls: [{ id: 'r1', name: 'researchDesign', args: '{"topic":"x","mode":"image"}' }] },
      { text: '这次没搜到，换个英文关键词试试？' },
    ], { ...imageReport(0), warnings: ['Bing 在固定设计站点里没有找到结果'] })
    const result = await runAgentTurn([{ role: 'user', content: '找图' }], d)
    expect(result.kind === 'message' && result.text).toBe('这次没搜到，换个英文关键词试试？')
  })

  it('keeps the reply for web research', async () => {
    const { deps: d } = deps([
      { toolCalls: [{ id: 'r1', name: 'researchDesign', args: '{"topic":"x","mode":"web"}' }] },
      { text: '## 趋势\n- 要点' },
    ], imageReport(5, 'web'))
    const result = await runAgentTurn([{ role: 'user', content: '调研一下' }], d)
    expect(result.kind === 'message' && result.text).toBe('## 趋势\n- 要点')
  })
})
