import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODE_FORM_STATE, STUDIO_MODES } from '../studioContracts'
import {
  appendProductUpload,
  appendReferenceUpload,
  buildStudioRequest,
  sellingPointFailureMessage,
  submitStudioGeneration,
  uploadFailureMessage,
  uploadRoom,
  usesAiPlan,
  validateStudioStart,
} from './studioRequestCoordinator'

const product = (nodeId: string) => ({ nodeId, hash: nodeId, preview: null })
const form = (mode = STUDIO_MODES[0]) => ({
  ...DEFAULT_MODE_FORM_STATE(mode),
  platformId: 'amazon',
  language: 'en' as const,
  ratio: 'smart',
  resolution: '2K',
  quality: 'high',
  note: '突出防水材质',
})

function baseRequest() {
  const mode = STUDIO_MODES[0]
  return buildStudioRequest({
    mode,
    modeOptions: { setStrategy: 'smart', setCounts: { whiteBg: 1, scene: 2 } },
    usage: mode.usage,
    form: form(mode),
    effectiveCount: 3,
    videoDuration: 5,
    products: [product('p1'), product('p2')],
    references: [product('r1')],
    model: 'image-model',
  })
}

describe('studio request coordinator', () => {
  it('builds every current request field and preserves source order', () => {
    const request = baseRequest()
    expect(request).toMatchObject({
      mediaKind: 'image',
      modeLabel: '商品套图',
      usage: 'set',
      platformId: 'amazon',
      language: 'en',
      count: 3,
      ratio: 'smart',
      resolution: '2K',
      quality: 'high',
      productNodeId: 'p1',
      productNodeIds: ['p1', 'p2'],
      referenceNodeIds: ['r1'],
      note: '突出防水材质',
      model: 'image-model',
    })
    expect(request.modePrompt).toContain('套图结构：智能匹配')
    expect(request.durationSec).toBeUndefined()
  })

  it('keeps video duration and omits image-only quality/resolution fields', () => {
    const mode = STUDIO_MODES.find((item) => item.id === 'video-commerce')!
    const request = buildStudioRequest({
      mode,
      modeOptions: {},
      usage: mode.usage,
      form: form(mode),
      effectiveCount: 8,
      videoDuration: 9,
      products: [product('p1')],
      references: [],
      model: '',
    })
    expect(request).toMatchObject({ mediaKind: 'video', count: 1, durationSec: 9 })
    expect(request.resolution).toBeUndefined()
    expect(request.quality).toBeUndefined()
    expect(request.model).toBeUndefined()
  })

  it('blocks the same start failures and exposes the first message unchanged', () => {
    const mode = STUDIO_MODES[0]
    const request = baseRequest()
    expect(validateStudioStart({
      mode,
      modeOptions: {},
      products: [],
      references: [],
      effectiveCount: 3,
      batchWhite: false,
      chatTargetLabel: '',
      request,
    })).toBe('先上传一张产品图 —— 没有产品图就没有可改的主体')
    expect(validateStudioStart({
      mode,
      modeOptions: {},
      products: [product('p1')],
      references: [],
      effectiveCount: 3,
      batchWhite: false,
      chatTargetLabel: '',
      request,
    })).toContain('配置渠道')
  })

  it('accepts a start with a chat target and keeps AI plan visibility tied to confirmation', () => {
    const mode = STUDIO_MODES[0]
    const request = baseRequest()
    expect(validateStudioStart({
      mode,
      modeOptions: {},
      products: [product('p1')],
      references: [product('r1')],
      effectiveCount: 3,
      batchWhite: false,
      chatTargetLabel: 'chat-model',
      request,
    })).toBeNull()
    expect(usesAiPlan(false, 'chat-model', request)).toBe(false)
    expect(usesAiPlan(true, 'chat-model', request)).toBe(true)
    expect(usesAiPlan(true, '', request)).toBe(false)
  })

  it('submits batch white products sequentially, each with its own only product and no references', async () => {
    const onGenerate = vi.fn(async (_request: unknown) => {})
    await submitStudioGeneration({
      batchWhite: true,
      products: [product('p1'), product('p2')],
      request: baseRequest(),
      onGenerate,
    })
    expect(onGenerate).toHaveBeenCalledTimes(2)
    expect(onGenerate.mock.calls[0]?.[0]).toMatchObject({
      productNodeId: 'p1',
      productNodeIds: ['p1'],
      referenceNodeIds: [],
    })
    expect(onGenerate.mock.calls[1]?.[0]).toMatchObject({
      productNodeId: 'p2',
      productNodeIds: ['p2'],
      referenceNodeIds: [],
    })
  })

  it('submits a normal request once and surfaces the original generation error', async () => {
    const onGenerate = vi.fn(async (_request: unknown) => {})
    await submitStudioGeneration({
      batchWhite: false,
      products: [product('p1')],
      request: baseRequest(),
      onGenerate,
    })
    expect(onGenerate).toHaveBeenCalledTimes(1)
    expect(onGenerate.mock.calls[0]?.[0]).toMatchObject({ productNodeIds: ['p1', 'p2'] })
    expect(uploadFailureMessage(new Error('上游 502'))).toBe('上游 502')
    expect(sellingPointFailureMessage('bad')).toBe('AI 帮写失败，请稍后重试')
  })

  it('keeps upload dedupe, limits and sequential drop room unchanged', () => {
    const capacity = { batchWhite: false, productLimit: 3, productCount: 1, referenceCount: 2 }
    expect(appendProductUpload([product('p1')], product('p1'), capacity)).toHaveLength(1)
    expect(appendProductUpload([product('p1')], product('p2'), capacity)).toHaveLength(2)
    expect(appendProductUpload(
      [product('p1'), product('p2'), product('p3')],
      product('p4'),
      { ...capacity, productCount: 3 },
    )).toHaveLength(3)
    expect(appendReferenceUpload([product('r1')], product('r2'), 2)).toHaveLength(2)
    expect(appendReferenceUpload([product('r1')], product('r2'), 3)).toHaveLength(1)
    expect(uploadRoom('product', capacity)).toBe(1)
    expect(uploadRoom('reference', capacity)).toBe(2)
  })
})
