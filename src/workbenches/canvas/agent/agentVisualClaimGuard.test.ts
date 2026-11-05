import { describe, expect, it, vi } from 'vitest'
import { deniesVisualCapability, visualEvidenceToCheck } from './agentVisualClaimGuard'
import { discoverAgentTools } from './toolCatalog'
import { AGENT_TOOLS, agentToolsForCapabilities } from './tools'

const user = (content: string, imageNodeIds?: string[]) => [{
  role: 'user' as const,
  content,
  ...(imageNodeIds ? { imageNodeIds } : {}),
}]

describe('agentVisualClaimGuard', () => {
  it('区分模型自述、无素材和确实没有视觉工具', () => {
    const messages = user('查看画布', ['img-1'])
    expect(deniesVisualCapability('我是纯文本模型，看不了图片')).toBe(true)
    expect(visualEvidenceToCheck(messages, '看不了图片', new Set(['visualReview']))).toBe(false)
    expect(visualEvidenceToCheck(user('查看画布'), '没有可看的图片', new Set(['visualReview']))).toBe(false)
    expect(visualEvidenceToCheck(messages, '我是纯文本模型', new Set())).toBe(false)
    expect(visualEvidenceToCheck(user('今天怎么样'), '图片不重要', new Set(['visualReview']))).toBe(false)
  })

  it('主对话已有图片输入时不抢占普通看图，也不产生视觉验收活动', async () => {
    const { runAgentTurn } = await import('./agentLoop')
    const executeRead = vi.fn()
    const replies = ['我是纯文本模型，看不了画布。', '图片里是一只猫。']
    const requests: { inputs: unknown[] }[] = []
    const adapter = { completeText: vi.fn(async (request: { inputs: unknown[] }) => {
      requests.push(request)
      return { text: replies.shift()! }
    }) }
    const messages = user('这个图有什么', ['img-1'])
    const result = await runAgentTurn(messages, {
      adapter,
      channelId: 'same-channel',
      model: 'same-model',
      tools: [{ name: 'visualReview', parameters: { type: 'object' } }],
      inputs: [{ kind: 'asset', nodeId: 'img-1', assetHash: 'hash-1', mime: 'image/png' }],
      executeRead,
      executeWrite: vi.fn(),
      signal: new AbortController().signal,
    })
    expect(adapter.completeText).toHaveBeenCalledTimes(2)
    for (const request of requests) expect(request.inputs).toHaveLength(1)
    expect(result.messages.filter((message) => message.content === '我是纯文本模型，看不了画布。')).toHaveLength(0)
    expect(executeRead).not.toHaveBeenCalled()
    expect(result.kind).toBe('message')
    if (result.kind === 'message') expect(result.text).toContain('一只猫')
    expect(result.messages.filter((message) => message.toolName === 'visualReview')).toHaveLength(0)
  })

  it('一次纠正后仍否认：如实失败，不循环重试、不调用验收', async () => {
    const { runAgentTurn } = await import('./agentLoop')
    const adapter = { completeText: vi.fn(async () => ({ text: '我是纯文本模型，看不了图片。' })) }
    const executeRead = vi.fn()
    const result = await runAgentTurn(user('这个图有什么', ['img-1']), {
      adapter, channelId: 'c', model: 'm', tools: [],
      inputs: [{ kind: 'asset', nodeId: 'img-1', assetHash: 'h', mime: 'image/png' }],
      executeRead, executeWrite: vi.fn(), signal: new AbortController().signal,
    })
    expect(adapter.completeText).toHaveBeenCalledTimes(2)
    expect(executeRead).not.toHaveBeenCalled()
    expect(result.kind).toBe('error')
    if (result.kind === 'error') expect(result.message).toBe('当前模型没有给出可靠图片描述')
    expect(result.messages.filter((message) => message.role === 'system' && message.content.includes('真实附上图片输入'))).toHaveLength(1)
  })

  it.each([
    ['零图片输入', undefined, new Set(['visualReview'])],
    ['纯文本模型没有视觉工具', [{ kind: 'asset' as const, nodeId: 'img-1', assetHash: 'h', mime: 'image/png' }], new Set<string>()],
  ])('%s 时保留真实限制，不虚构 visualReview 调用', async (_label, inputs, available) => {
    const { runAgentTurn } = await import('./agentLoop')
    const executeRead = vi.fn()
    const result = await runAgentTurn(user('查看画布', ['img-1']), {
      adapter: { completeText: vi.fn(async () => ({ text: '当前没有可读取的图片素材。' })) },
      channelId: 'c', model: 'text-only', tools: AGENT_TOOLS.filter((tool) => available.has(tool.name)),
      ...(inputs ? { inputs } : {}), executeRead, executeWrite: vi.fn(), signal: new AbortController().signal,
    })
    expect(result.kind).toBe('message')
    expect(executeRead).not.toHaveBeenCalled()
  })

  it('普通查看不加载验收；明确质检才按开关加载', () => {
    expect(discoverAgentTools('这个图有什么', agentToolsForCapabilities({ canvasReview: true })).tools
      .map((tool) => tool.name)).not.toContain('visualReview')
    expect(discoverAgentTools('检查这四张图是否一致', agentToolsForCapabilities({ canvasReview: true })).tools
      .map((tool) => tool.name)).toContain('visualReview')
  })

  it('明确验收即使已有 chat 图片，模型否认也不能阻断 visualReview', async () => {
    const { runAgentTurn } = await import('./agentLoop')
    const executeRead = vi.fn(async () => ({ ok: true, verdict: 'pass', summary: '四张图一致', issues: [], limitations: [] }))
    const replies = [{ text: '我看不了图片。' }, { text: '', toolCalls: [{ id: 'review', name: 'visualReview', args: '{"nodeIds":["img-1"]}' }] }, { text: '验收完成：四张图一致。' }]
    const result = await runAgentTurn(user('检查这四张图是否一致', ['img-1']), {
      adapter: { completeText: vi.fn(async () => replies.shift()!) }, channelId: 'c', model: 'm',
      tools: AGENT_TOOLS.filter((tool) => tool.name === 'visualReview'),
      inputs: [{ kind: 'asset', nodeId: 'img-1', assetHash: 'h', mime: 'image/png' }],
      executeRead, executeWrite: vi.fn(), signal: new AbortController().signal,
    })
    expect(executeRead).toHaveBeenCalledWith('visualReview', { nodeIds: ['img-1'] }, 'review')
    expect(result.kind).toBe('message')
  })
})
