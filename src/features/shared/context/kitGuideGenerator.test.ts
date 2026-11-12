import { describe, expect, it, vi } from 'vitest'
import { generateKitGuide, resolveKitVisionRoute, type KitGuideDeps } from './kitGuideGenerator'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2])
const GUIDE = JSON.stringify({ summary: '概述', dos: ['留白'], donts: ['投影'], colors: [], fonts: [], applications: [] })

function channel(models: { id: string; inputTypes: string[] }[]) {
  return { id: 'ch1', name: 'c', enabled: true, protocol: 'openai', baseUrl: '', icon: null, credentialRef: null, tokenTail: null, priority: 0, weight: 1, modelMap: {}, models: models.map((m) => ({ ...m, category: 'chat' })) }
}

function deps(over: { review?: string | null; text?: string; fail?: unknown; models?: { id: string; inputTypes: string[] }[] } = {}) {
  const completeWithTools = vi.fn(async (req: { signal: AbortSignal }) => {
    if (over.fail) throw over.fail
    if (req.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    return { text: over.text ?? GUIDE }
  })
  const planGenerationRoute = vi.fn(async ({ logicalModel }: { logicalModel: string }) => ({
    ok: true as const,
    plan: { logicalModel, capability: 'chat', strategy: 'priority', candidates: [{ channelId: 'ch1', model: `${logicalModel}-up` }] },
  }))
  const value = {
    channels: {
      getState: () => ({ channels: [channel(over.models ?? [{ id: 'text-only', inputTypes: ['text'] }, { id: 'vision', inputTypes: ['text', 'image'] }])] }),
      globalModelsOf: () => [{ id: 'text-only' }, { id: 'vision' }],
      planGenerationRoute,
      completeWithTools,
    },
    presets: {
      loadAgentReviewModel: async () => over.review ?? null,
      loadAgentDefault: async () => ({ model: 'text-only' }),
    },
    assets: { read: async (hash: string) => (hash === 'missing' ? null : { bytes: PNG, mime: 'image/png' }) },
  }
  return { deps: value as unknown as KitGuideDeps, completeWithTools, planGenerationRoute }
}

const request = (signal = new AbortController().signal) => ({
  kitId: 'kit1',
  projectId: 'p1',
  kind: 'brand' as const,
  name: 'Anbel',
  description: '',
  resources: [
    { hash: 'ref', role: 'reference' as const, name: 'r' },
    { hash: 'logo', role: 'logo' as const, name: 'l' },
    { hash: 'missing', role: 'reference' as const, name: 'm' },
  ],
  colors: [{ id: 'c', name: '主色', value: '#112233' }],
  fonts: [],
  signal,
})

describe('kitGuideGenerator', () => {
  it('跳过不支持看图的模型，选第一个能看图的对话模型', async () => {
    const { deps: d } = deps()
    const route = await resolveKitVisionRoute(d)
    expect(route.ok && route.route.logicalModel).toBe('vision')
  })

  it('视觉验收模型优先', async () => {
    const { deps: d } = deps({ review: 'vision', models: [{ id: 'vision', inputTypes: ['image'] }, { id: 'other', inputTypes: ['image'] }] })
    const route = await resolveKitVisionRoute(d)
    expect(route.ok && route.route.logicalModel).toBe('vision')
  })

  it('没有看图模型时给出可操作的提示', async () => {
    const { deps: d } = deps({ models: [{ id: 'vision', inputTypes: ['text'] }] })
    const outcome = await generateKitGuide(d, request())
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.message).toContain('视觉验收模型')
  })

  it('Logo 在前发送图片、颜色进提示词，结果格式化为结构化指南', async () => {
    const { deps: d, completeWithTools } = deps()
    const outcome = await generateKitGuide(d, request())
    expect(outcome.ok).toBe(true)
    const sent = completeWithTools.mock.calls[0]![0] as unknown as { inputs: { assetHash: string }[]; messages: { content: string }[]; tools: unknown[] }
    expect(sent.inputs.map((input) => input.assetHash)).toEqual(['logo', 'ref'])
    expect(sent.tools).toEqual([])
    expect(sent.messages[1]!.content).toContain('主色 #112233')
    if (outcome.ok) {
      expect(outcome.text).toContain('## 概述')
      expect(outcome.text).toContain('- #112233：主色')
      expect(outcome.limitations.join()).toContain('读不到图片字节')
    }
  })

  it('取消返回 cancelled，不当作错误', async () => {
    const controller = new AbortController()
    controller.abort()
    const { deps: d, completeWithTools } = deps()
    const outcome = await generateKitGuide(d, request(controller.signal))
    expect(outcome).toMatchObject({ ok: false, cancelled: true })
    expect(completeWithTools).not.toHaveBeenCalled()
  })

  it('渠道错误信息里的 Key 被抹掉', async () => {
    const { deps: d } = deps({ fail: new Error('401 invalid sk-1234567890abcdef') })
    const outcome = await generateKitGuide(d, request())
    expect(!outcome.ok && outcome.message).toBe('生成失败：401 invalid sk-***')
  })

  it('模型返回非 JSON 时失败且不产生指南', async () => {
    const { deps: d } = deps({ text: '我无法查看图片' })
    const outcome = await generateKitGuide(d, request())
    expect(outcome.ok).toBe(false)
  })

  it('没有任何素材时不调用模型', async () => {
    const { deps: d, planGenerationRoute } = deps()
    const outcome = await generateKitGuide(d, { ...request(), resources: [], colors: [] })
    expect(outcome.ok).toBe(false)
    expect(planGenerationRoute).not.toHaveBeenCalled()
  })
})
