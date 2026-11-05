import { describe, expect, it } from 'vitest'
import { DEFAULT_ECOMMERCE_FORM_DRAFT } from '../../../../domain/ecommerce/draft'
import { STUDIO_MODES } from '../studioContracts'
import {
  applyModeFormPatch,
  ensureStudioModeState,
  initialStudioFormState,
  nextModeFormAfterModelChange,
  orderedStudioPlatforms,
  projectStudioForm,
  pruneSelectedEditNodes,
  setStudioModeOption,
  studioCarouselCases,
  studioEditPresets,
  studioFieldVisibility,
  studioFormDraft,
  studioImageParameterChoices,
  toggleStudioModeOption,
} from './studioFormProjection'
import { ecommerceLanguageOptionLabel } from '../../../../domain/ecommerce/types'

const product = (nodeId: string) => ({ nodeId, hash: nodeId, preview: null })
const result = (nodeId: string, status: 'running' | 'done' | 'failed', mime?: string) => ({
  nodeId,
  status,
  ...(mime ? { mime } : {}),
})

describe('studio form projection', () => {
  it('restores the exact historical mode, per-mode state and options', () => {
    const saved = {
      ...DEFAULT_ECOMMERCE_FORM_DRAFT,
      modeLabel: '视频复刻',
      mediaKind: 'video' as const,
      videoDuration: 12,
      usage: 'recreate' as const,
      platformId: 'shopee',
      language: 'ja' as const,
      ratio: '9:16',
      resolution: '2K',
      quality: 'high',
      note: '保留原镜头节奏',
      modeOptions: { videoReplicateMode: 'full' },
      modeStates: { 'product-set': DEFAULT_ECOMMERCE_FORM_DRAFT.modeStates['product-set'] ?? {
        platformId: 'amazon',
        language: 'en' as const,
        ratio: 'smart',
        resolution: 'auto',
        quality: 'auto',
        note: 'old',
      } },
    }
    const state = initialStudioFormState(saved)
    expect(state.initialMode.id).toBe('video-recreate')
    expect(state.category).toBe('video')
    expect(state.videoDuration).toBe(12)
    expect(state.usage).toBe('recreate')
    expect(state.modeStates['video-recreate']).toEqual({
      platformId: 'shopee',
      language: 'ja',
      ratio: '9:16',
      resolution: '2K',
      quality: 'high',
      note: '保留原镜头节奏',
    })
    expect(state.modeStates['product-set'].note).toBe('old')
    expect(state.modeOptionsByMode['video-recreate']).toMatchObject({
      videoReplicateMode: 'full',
    })
  })

  it('falls back by usage and media kind when a historical label is stale', () => {
    const state = initialStudioFormState({
      ...DEFAULT_ECOMMERCE_FORM_DRAFT,
      modeLabel: '不存在的旧模式',
      mediaKind: 'video',
      usage: 'set',
    })
    expect(state.initialMode.id).toBe('video-commerce')
  })

  it('patches one mode without mutating another and preserves option toggling order', () => {
    const mode = STUDIO_MODES[0]
    const current = initialStudioFormState(null).modeStates
    const patched = applyModeFormPatch(current, mode, { note: '只改套图' })
    expect(patched[mode.id].note).toBe('只改套图')
    expect(current[mode.id].note).toBe('')
    const first = setStudioModeOption({}, 'wearTypes', ['threeD'])
    const second = toggleStudioModeOption(first, 'wearTypes', 'mannequin')
    expect(second.wearTypes).toEqual(['threeD', 'mannequin'])
    expect(toggleStudioModeOption(second, 'wearTypes', 'threeD').wearTypes).toEqual(['mannequin'])
  })

  it('creates missing mode state exactly once and keeps an existing identity', () => {
    const mode = STUDIO_MODES[3]
    const current = { [mode.id]: { id: mode.id } }
    expect(ensureStudioModeState(current, mode, { id: 'new' })).toBe(current)
    expect(ensureStudioModeState({}, mode, { id: 'new' })).toEqual({ [mode.id]: { id: 'new' } })
  })

  it('projects batch white count, visible media and category modes', () => {
    const mode = STUDIO_MODES.find((item) => item.id === 'product-white')!
    const projection = projectStudioForm({
      modeId: mode.id,
      category: 'product',
      fallbackMode: STUDIO_MODES[0],
      modeStates: {},
      modeOptionsByMode: {
        [mode.id]: { whiteBatch: 'on', whiteBgCounts: { front: 2, side: 3 } },
      },
      products: [product('p1'), product('p2'), product('p3')],
      results: [
        result('image', 'done', 'image/png'),
        result('video', 'done', 'video/mp4'),
        result('unknown', 'running'),
      ],
    })
    expect(projection.batchWhite).toBe(true)
    expect(projection.effectiveCount).toBe(5)
    expect(projection.batchOutputCount).toBe(15)
    expect(projection.productLimit).toBe(12)
    expect(projection.visibleResults.map((item) => item.nodeId)).toEqual(['image', 'unknown'])
    expect(projection.categoryModes.every((item) => item.category === 'product')).toBe(true)
  })

  it('serializes the current draft from the active mode and keeps upload order', () => {
    const mode = STUDIO_MODES[0]
    const form = {
      platformId: 'amazon',
      language: 'en' as const,
      ratio: 'smart',
      resolution: '2K',
      quality: 'high',
      note: '强调材质',
    }
    const draft = studioFormDraft({
      mode,
      videoDuration: 5,
      usage: 'set',
      modeFormState: form,
      effectiveCount: 8,
      model: 'image-model',
      modeOptions: { setStrategy: 'smart' },
      modeStates: { [mode.id]: { ...form, note: '旧值' } },
      products: [product('p1'), product('p2')],
      references: [product('r1')],
    })
    expect(draft).toMatchObject({
      modeLabel: mode.label,
      mediaKind: 'image',
      count: 8,
      model: 'image-model',
      productNodeId: 'p1',
      productNodeIds: ['p1', 'p2'],
      referenceNodeIds: ['r1'],
    })
    expect(draft.modeStates[mode.id].note).toBe('强调材质')
  })

  it('orders platforms by the canonical rank then local name', () => {
    const platforms = orderedStudioPlatforms([
      { id: 'unknown-b', name: 'B平台' },
      { id: 'amazon', name: '亚马逊' },
      { id: 'unknown-a', name: 'A平台' },
    ] as never)
    expect(platforms.map((item) => item.id)).toEqual(['amazon', 'unknown-a', 'unknown-b'])
  })

  it('prunes stale selected results without replacing an unchanged set identity input', () => {
    const current = new Set(['done', 'failed'])
    const next = pruneSelectedEditNodes(current, [
      result('done', 'done'),
      result('failed', 'failed'),
    ])
    expect([...next]).toEqual(['done'])
    const unchanged = pruneSelectedEditNodes(new Set(['done']), [result('done', 'done')])
    expect([...unchanged]).toEqual(['done'])
  })

  it('resets only unsupported image parameters after a model change', () => {
    expect(nextModeFormAfterModelChange(
      { next: { resolutions: ['1K'], qualities: ['high'] } },
      'next',
      { resolution: '2K', quality: 'high' },
    )).toEqual({ resolution: 'auto', quality: 'high' })
  })

  it('keeps field visibility, parameter choices, edit presets and cases deterministic', () => {
    const mode = STUDIO_MODES.find((item) => item.id === 'wear-tryon')!
    const visibility = studioFieldVisibility(mode, [{ value: 'auto' }, { value: 'high' }])
    expect(visibility).toMatchObject({
      referenceRequired: true,
      showReferenceBlock: true,
      referenceLabel: '人物参考图',
      showCommonFields: false,
      showSellingPoints: false,
    })
    expect(studioImageParameterChoices({}, '').resolutionChoices).toEqual([
      { value: 'auto', label: '自动' },
      { value: '1K', label: '1K' },
      { value: '2K', label: '2K' },
      { value: '4K', label: '4K' },
    ])
    expect(studioEditPresets('zh-CN', 'set', ecommerceLanguageOptionLabel)[3].label).toBe('翻译成中文')
    expect(studioCarouselCases(mode)).toHaveLength(3)
  })
})
