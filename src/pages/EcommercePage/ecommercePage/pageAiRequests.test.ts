import { describe, expect, it, vi } from 'vitest'
import {
  requestEcommerceIntent,
  requestEcommerceSellingPoints,
  requestEcommerceShots,
  type EcommerceShotRequestPorts,
  type EcommerceTextRequestPorts,
} from './pageAiRequests'
import { ECOMMERCE_SHOTS_MARKER } from '../../../domain/ecommerce/chatShots'
import { directTextTrace } from '../../../state/shared/directRun'

const target = { channelId: 'ch', logicalModel: '逻辑名', upstreamModel: 'upstream' }

function textPorts(text = '回复', overrides: Partial<EcommerceTextRequestPorts> = {}): EcommerceTextRequestPorts {
  const controller = new AbortController()
  return {
    projectId: 'p',
    chatTarget: target,
    operationId: 'op-1',
    completeWithTools: vi.fn(async () => ({ text })),
    directTextTrace,
    onRecordWarning: vi.fn(),
    abortSignal: () => controller.signal,
    clearTimer: vi.fn(),
    ...overrides,
  }
}

describe('ecommerce page AI requests', () => {
  it('keeps intent parse success, timeout and generic failure paths', async () => {
    const ports = textPorts()
    const input = {
      text: '亚马逊防水商品图',
      platforms: [],
      buildSystem: () => 'system',
      buildUser: (text: string) => `user:${text}`,
      parse: vi.fn(() => ({ ok: true as const, draft: { note: '防水' } })),
    }
    await expect(requestEcommerceIntent(ports, input)).resolves.toEqual({ ok: true, draft: { note: '防水' } })
    expect(ports.completeWithTools).toHaveBeenCalledWith(expect.objectContaining({
      model: 'upstream', modelIsUpstream: true, tools: [],
      messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'user:亚马逊防水商品图' }],
    }))
    expect(ports.clearTimer).toHaveBeenCalledTimes(1)

    const aborted = new AbortController()
    aborted.abort()
    await expect(requestEcommerceIntent(textPorts('', {
      abortSignal: () => aborted.signal,
      completeWithTools: vi.fn(async () => { throw new Error('ignored') }),
    }), input)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('解析超时') })

    await expect(requestEcommerceIntent(textPorts('', {
      completeWithTools: vi.fn(async () => { throw new Error('network') }),
    }), input)).resolves.toMatchObject({ ok: false, error: expect.stringContaining('解析失败') })
  })

  it('writes only supplied facts, strips fenced replies and caps selling points', async () => {
    const ports = textPorts('```text\n柔软面料，适合日常通勤。\n```')
    const request = {
      usage: 'set',
      mediaKind: 'image',
      language: 'zh-CN',
      platformId: 'amazon',
      count: 1,
      ratio: '1:1',
      note: '  真实卖点  ',
      productNodeId: 'p1',
      referenceNodeIds: [],
    } as never
    await expect(requestEcommerceSellingPoints(ports, {
      request,
      platformsWithName: [{ id: 'amazon', name: '亚马逊' }],
      systemPrompt: 'facts only',
      languageLabel: () => '中文',
    })).resolves.toBe('柔软面料，适合日常通勤。')
    const sent = vi.mocked(ports.completeWithTools).mock.calls[0]?.[0]
    expect(sent?.messages[1]?.content).toContain('平台：亚马逊')
    expect(sent?.messages[1]?.content).toContain('用户已有要求：真实卖点')
    expect(sent?.trace.subjectId).toBe('p1')

    const aborted = new AbortController()
    aborted.abort()
    await expect(requestEcommerceSellingPoints(textPorts('', {
      abortSignal: () => aborted.signal,
      completeWithTools: vi.fn(async () => { throw new Error('ignored') }),
    }), {
      request,
      platformsWithName: [],
      systemPrompt: 'facts only',
      languageLabel: () => '中文',
    })).rejects.toThrow('AI 帮写超时')
  })

  it('stops two-pass shot planning before paid generation on parse failure or cancellation', async () => {
    const designSystem = {
      name: '柔白商品视觉',
      palette: ['暖白', '浅灰'],
      typography: '简洁无衬线',
      lighting: '均匀柔光',
      composition: '主体清楚',
      imageTreatment: '真实材质',
    }
    const validDraft = JSON.stringify({
      productAnalysis: { summary: '商品分析' },
      designSystem,
      shots: [{
        title: '主图', brief: '突出防水', prompt: '完整可用的最终提示词，不提版式',
        ratio: '1:1', headline: '防水', subheadline: '日常',
      }],
    })
    const review = JSON.stringify({
      productAnalysis: { summary: '商品分析' },
      designSystem,
      shots: [{
        title: '主图', brief: '突出防水', prompt: '自审后的完整最终提示词，不提版式',
        ratio: '1:1', headline: '防水', subheadline: '日常',
      }],
    })
    const stages: string[] = []
    const ports: EcommerceShotRequestPorts = {
      ...textPorts(),
      completeWithTools: vi.fn()
        .mockResolvedValueOnce({ text: `${ECOMMERCE_SHOTS_MARKER}${validDraft}` })
        .mockResolvedValueOnce({ text: `${ECOMMERCE_SHOTS_MARKER}${review}` }),
      visualInputs: [{ kind: 'asset', nodeId: 'p1', assetHash: 'h', mime: 'image/png' }],
      platforms: [],
      setStage: (stage) => stages.push(stage.label),
    }
    const request = {
      usage: 'set', mediaKind: 'image', language: 'zh-CN', platformId: 'amazon',
      count: 1, ratio: '1:1', note: '防水', productNodeId: 'p1', referenceNodeIds: [],
    } as never
    const result = await requestEcommerceShots(ports, request)
    expect(result.ok).toBe(true)
    expect(ports.completeWithTools).toHaveBeenCalledTimes(2)
    expect(stages).toEqual(['正在分析商品原图与需求', 'AI 正在自审并修正方案', '逐张提示词已通过自审'])
    expect(vi.mocked(ports.completeWithTools).mock.calls[1]?.[0].trace.params).toMatchObject({
      purpose: 'ecommerce-review',
    })

    const badDraft = { ...ports, completeWithTools: vi.fn(async () => ({ text: '不是 JSON' })) }
    await expect(requestEcommerceShots(badDraft, request)).resolves.toMatchObject({ ok: false })
    expect(badDraft.completeWithTools).toHaveBeenCalledTimes(1)

    const aborted = new AbortController()
    const cancelPorts = {
      ...ports,
      abortSignal: () => { aborted.abort(); return aborted.signal },
      completeWithTools: vi.fn(async () => { throw new Error('ignored') }),
    }
    await expect(requestEcommerceShots(cancelPorts, request)).resolves.toEqual({
      ok: false,
      error: '商品分析与提示词请求超时（60 秒没回）。',
    })
  })
})
