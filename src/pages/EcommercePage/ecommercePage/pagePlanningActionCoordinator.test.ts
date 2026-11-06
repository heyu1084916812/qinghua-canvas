import { describe, expect, it, vi } from 'vitest'
import type { EcommerceIntentDraft } from '../../../domain/ecommerce/chatParse'
import { ECOMMERCE_SHOTS_MARKER } from '../../../domain/ecommerce/chatShots'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { AgentSession } from '../../../state/agent/agentSessionTypes'
import type { LegacyGenerationNode } from '../ecommercePageSupport'
import {
  createPagePlanningActionCoordinator,
  type PagePlanningActionPorts,
  type PagePlanningStatePort,
} from './pagePlanningActionCoordinator'

const target = {
  channelId: 'channel-1',
  logicalModel: '逻辑模型',
  upstreamModel: 'upstream-model',
}

const draft: EcommerceIntentDraft = {
  usage: 'detail',
  platformId: 'amazon',
  language: 'en',
  count: 2,
  ratio: '1:1',
  note: '防水',
}

const requestOf = (overrides: Partial<EcommerceRequest> = {}): EcommerceRequest => ({
  usage: 'set',
  mediaKind: 'image',
  language: 'zh-CN',
  platformId: 'amazon',
  count: 1,
  ratio: '1:1',
  note: '  真实卖点  ',
  productNodeId: 'product-1',
  productNodeIds: ['product-2'],
  referenceNodeIds: ['reference-1'],
  ...overrides,
})

const sessionOf = (id: string, updatedAt: number, value: EcommerceIntentDraft = draft) => ({
  id,
  title: id,
  messages: [{ role: 'assistant' as const, content: JSON.stringify(value) }],
  createdAt: updatedAt,
  updatedAt,
})

const agentSessionOf = (): AgentSession => ({
  id: 'chat-1',
  projectId: 'project-1',
  title: '亚马逊方案',
  channelId: 'channel-1',
  model: '逻辑模型',
  queuedTurns: [],
  pendingSteers: [],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
})

function harness(overrides: Partial<PagePlanningActionPorts> = {}) {
  const events: string[] = []
  const setters: PagePlanningStatePort = {
    setIntent: vi.fn(),
    setIntentError: vi.fn(),
    setParsingIntent: vi.fn(),
    setPlanHistory: vi.fn(),
    setPreparingShots: vi.fn(),
    setTextRecordWarning: vi.fn(),
    setGenerationStage: vi.fn(),
  }
  const ports: PagePlanningActionPorts = {
    projectId: 'project-1',
    platforms: [],
    sessions: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => agentSessionOf()),
      save: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    },
    assets: {
      read: vi.fn(async () => ({ mime: 'image/png' })),
    },
    logger: { log: vi.fn() },
    completeWithTools: vi.fn(async () => ({ text: '{}' })),
    onTextRecordWarning: vi.fn(),
    operationId: vi.fn(() => 'op-1'),
    state: setters,
    ...overrides,
  }
  return {
    events,
    setters,
    ports,
    coordinator: createPagePlanningActionCoordinator(ports),
  }
}

describe('ecommerce planning history', () => {
  it('loads, filters and orders plan history', async () => {
    const h = harness()
    vi.mocked(h.ports.sessions.list).mockResolvedValue([
      sessionOf('older', 1),
      { id: 'invalid', title: 'invalid', messages: [], createdAt: 2, updatedAt: 2 },
      sessionOf('newer', 3, { ...draft, count: 3 }),
    ])

    await h.coordinator.refreshPlanHistory()

    expect(h.setters.setPlanHistory).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'newer', draft: expect.objectContaining({ count: 3 }) }),
      expect.objectContaining({ id: 'older' }),
    ])
  })

  it('logs history read failures without replacing the existing list', async () => {
    const h = harness()
    vi.mocked(h.ports.sessions.list).mockRejectedValue(new Error('disk'))

    await h.coordinator.refreshPlanHistory()

    expect(h.setters.setPlanHistory).not.toHaveBeenCalled()
    expect(h.ports.logger.log).toHaveBeenCalledWith(
      'warn',
      '[ecommerce] 方案历史读取失败',
      { error: 'Error: disk' },
    )
  })
})

describe('ecommerce intent actions', () => {
  it('saves only a successful parse and refreshes history in order', async () => {
    const h = harness()
    vi.mocked(h.ports.completeWithTools).mockResolvedValue({
      text: JSON.stringify({
        ...draft,
        count: 2,
        ratio: '1:1',
        note: '防水',
      }),
    })
    vi.mocked(h.ports.sessions.list).mockResolvedValue([])

    await h.coordinator.parseIntent('亚马逊防水详情页', target)
    await vi.waitFor(() => {
      expect(h.ports.sessions.save).toHaveBeenCalledTimes(1)
    })

    expect(h.setters.setIntent).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }))
    expect(h.ports.sessions.create).toHaveBeenCalledWith({
      projectId: 'project-1',
      channelId: 'channel-1',
      model: '逻辑模型',
      title: '亚马逊防水详情页',
    })
    expect(vi.mocked(h.ports.sessions.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(h.ports.sessions.save).mock.invocationCallOrder[0],
    )
    expect(vi.mocked(h.ports.sessions.save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(h.ports.sessions.list).mock.invocationCallOrder[0],
    )
    expect(h.setters.setParsingIntent).toHaveBeenNthCalledWith(1, true)
    expect(h.setters.setParsingIntent).toHaveBeenLastCalledWith(false)
  })

  it('keeps parse errors and never writes a plan session', async () => {
    const h = harness()
    vi.mocked(h.ports.completeWithTools).mockResolvedValue({ text: '不是 JSON' })

    await h.coordinator.parseIntent('这句话解析不出来', target)

    expect(h.setters.setIntent).toHaveBeenCalledTimes(1)
    expect(h.setters.setIntent).toHaveBeenNthCalledWith(1, null)
    expect(h.setters.setIntentError).toHaveBeenCalledWith(
      expect.stringContaining('没解析出参数'),
    )
    expect(h.ports.sessions.create).not.toHaveBeenCalled()
    expect(h.ports.sessions.save).not.toHaveBeenCalled()
  })

  it('reports a missing chat target without entering the parsing busy state', async () => {
    const h = harness()

    await h.coordinator.parseIntent('亚马逊详情页', null)

    expect(h.setters.setIntentError).toHaveBeenCalledWith(
      expect.stringContaining('没有可用的对话模型'),
    )
    expect(h.setters.setParsingIntent).not.toHaveBeenCalled()
    expect(h.ports.completeWithTools).not.toHaveBeenCalled()
  })
})

describe('ecommerce selling point actions', () => {
  it('trims fenced selling points and forwards supplied request facts', async () => {
    const h = harness()
    vi.mocked(h.ports.completeWithTools).mockResolvedValue({
      text: '```text\n柔软面料，适合日常通勤。\n```',
    })

    await expect(h.coordinator.writeSellingPoints(requestOf(), target)).resolves.toBe(
      '柔软面料，适合日常通勤。',
    )

    const call = vi.mocked(h.ports.completeWithTools).mock.calls[0]?.[0]
    expect(call?.messages[1]?.content).toContain('用户已有要求：真实卖点')
    expect(h.setters.setTextRecordWarning).toHaveBeenCalledWith('')
  })

  it('keeps the missing-target and upstream failure semantics', async () => {
    const h = harness()
    await expect(
      h.coordinator.writeSellingPoints(requestOf(), null),
    ).rejects.toThrow('先在模型服务里勾选一个对话模型')

    vi.mocked(h.ports.completeWithTools).mockRejectedValue(new Error('network'))
    await expect(
      h.coordinator.writeSellingPoints(requestOf(), target),
    ).rejects.toThrow('AI 帮写失败，请稍后重试')
  })
})

describe('ecommerce plan history actions', () => {
  it('restores the card fields and deletes before refresh', async () => {
    const h = harness()
    vi.mocked(h.ports.sessions.remove).mockImplementation(async () => {
      h.events.push('remove')
    })
    vi.mocked(h.ports.sessions.list).mockImplementation(async () => {
      h.events.push('list')
      return []
    })

    h.coordinator.restorePlan({
      id: 'history-1',
      title: '旧方案',
      draft: { ...draft, note: '旧备注' },
      createdAt: 1,
      updatedAt: 2,
    })
    await h.coordinator.removePlan('history-1')

    expect(h.setters.setIntent).toHaveBeenCalledWith(expect.objectContaining({ note: '旧备注' }))
    expect(h.setters.setIntentError).toHaveBeenCalledWith('')
    expect(h.events).toEqual(['remove', 'list'])
  })
})

describe('ecommerce shot planning actions', () => {
  const validShotsReply = JSON.stringify({
    productAnalysis: { summary: '商品分析' },
    designSystem: {
      name: '柔白商品视觉',
      palette: ['暖白', '浅灰'],
      typography: '简洁无衬线',
      lighting: '均匀柔光',
      composition: '主体清楚',
      imageTreatment: '真实材质',
    },
    shots: [{
      title: '主图',
      brief: '突出防水',
      prompt: '完整可用的最终提示词，不提版式',
      ratio: '1:1',
      headline: '防水',
      subheadline: '日常',
    }],
  })

  it('projects visual inputs, requests two passes and records trace in order', async () => {
    const readAsset = vi.fn(async (nodeId: string) => ({
      mime: nodeId === 'reference-1' ? 'image/jpeg' : 'image/png',
    }))
    const h = harness({ assets: { read: readAsset } })
    vi.mocked(h.ports.completeWithTools)
      .mockResolvedValueOnce({ text: `${ECOMMERCE_SHOTS_MARKER}${validShotsReply}` })
      .mockResolvedValueOnce({ text: `${ECOMMERCE_SHOTS_MARKER}${validShotsReply}` })

    const result = await h.coordinator.planShots(
      requestOf(),
      target,
      [] as LegacyGenerationNode[],
    )

    expect(result.ok).toBe(true)
    expect(readAsset.mock.calls.map(([nodeId]) => nodeId)).toEqual([
      'product-1',
      'product-2',
      'reference-1',
    ])
    const calls = vi.mocked(h.ports.completeWithTools).mock.calls.map(([input]) => input)
    expect(calls).toHaveLength(2)
    expect(
      calls.map(
        (input) =>
          (input.trace.params as { purpose?: string } | undefined)?.purpose,
      ),
    ).toEqual([
      'ecommerce-shots',
      'ecommerce-review',
    ])
    expect(calls[0]?.inputs).toHaveLength(3)
    expect(calls[0]?.inputs?.map((input) => input.nodeId)).toEqual([
      'product-1',
      'product-2',
      'reference-1',
    ])
    expect(calls.map((input) => input.messages[1]?.content)).toEqual([
      expect.stringContaining('真实卖点'),
      expect.any(String),
    ])
    expect(
      vi.mocked(h.setters.setGenerationStage).mock.calls.map(([stage]) => stage.label),
    ).toEqual(expect.arrayContaining([
      '正在分析商品原图与需求',
      'AI 正在自审并修正方案',
      '逐张提示词已通过自审',
    ]))
    expect(h.setters.setPreparingShots).toHaveBeenNthCalledWith(1, true)
    expect(h.setters.setPreparingShots).toHaveBeenLastCalledWith(false)
  })

  it('stops without loading assets or calling AI when there is no usable image', async () => {
    const h = harness()
    vi.mocked(h.ports.assets.read).mockResolvedValue(null)

    const result = await h.coordinator.planShots(
      requestOf(),
      target,
      [] as LegacyGenerationNode[],
    )

    expect(result).toEqual({
      ok: false,
      error: '没有可随对话发送的商品图 —— 无法先分析产品外观，已停止本次生图。',
    })
    expect(h.ports.completeWithTools).not.toHaveBeenCalled()
    expect(h.setters.setPreparingShots).toHaveBeenNthCalledWith(1, true)
    expect(h.setters.setPreparingShots).toHaveBeenLastCalledWith(false)
  })

  it('returns the request failure and still unlocks shot preparation', async () => {
    const h = harness()
    vi.mocked(h.ports.completeWithTools).mockRejectedValue(new Error('network'))

    const result = await h.coordinator.planShots(
      requestOf(),
      target,
      [] as LegacyGenerationNode[],
    )

    expect(result).toEqual({
      ok: false,
      error: '对话模型请求失败。',
    })
    expect(h.setters.setPreparingShots).toHaveBeenNthCalledWith(1, true)
    expect(h.setters.setPreparingShots).toHaveBeenLastCalledWith(false)
    expect(h.setters.setIntent).not.toHaveBeenCalled()
    expect(h.ports.sessions.create).not.toHaveBeenCalled()
  })
})
