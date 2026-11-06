import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { STUDIO_MODES, type EcommerceUpload } from './studioContracts'
import { studioCarouselCases } from './controller/studioFormProjection'
import { availableStudioUpscaleOptions } from './controller/studioResultActionCoordinator'
import { EcommerceStudioCategoryRail } from './EcommerceStudioCategoryRail'
import { EcommerceStudioUploadPanels } from './EcommerceStudioUploadPanels'
import { EcommerceStudioCommonParameters } from './EcommerceStudioCommonParameters'
import { EcommerceStudioSellingPointsPanel } from './EcommerceStudioSellingPointsPanel'
import { EcommerceStudioModelFields } from './EcommerceStudioModelFields'
import { EcommerceStudioResultsPane } from './EcommerceStudioResultsPane'
import { EcommerceStudioResultDetailDialogs } from './EcommerceStudioResultDetailDialogs'
import { EcommerceStudioEditDialogs } from './EcommerceStudioEditDialogs'
import { EcommerceStudioUpscaleDialog } from './EcommerceStudioUpscaleDialog'
import { EcommerceStudioUploadPreviewDialog } from './EcommerceStudioUploadPreviewDialog'
import { EcommerceStudioGenerateConfirmDialog } from './EcommerceStudioGenerateConfirmDialog'

const mode = STUDIO_MODES.find((item) => item.id === 'product-set')
if (!mode) throw new Error('missing product-set studio mode')

const preview = (label: string) => createElement('span', { 'data-preview': label }, label)
const upload = (nodeId: string): EcommerceUpload => ({
  nodeId,
  hash: `${nodeId}-hash`,
  preview: preview(nodeId),
})
const uploadDropProps = () => ({
  onDragOver: vi.fn(),
  onDragLeave: vi.fn(),
  onDrop: vi.fn(),
})

describe('ecommerce studio view extraction', () => {
  it('keeps category and upload anchors without adding layout wrappers', () => {
    const categoryHtml = renderToStaticMarkup(createElement(EcommerceStudioCategoryRail, {
      category: 'product',
      onSelect: vi.fn(),
    }))
    expect(categoryHtml.startsWith('<aside')).toBe(true)
    expect(categoryHtml).toContain('data-ecommerce-categories')
    expect(categoryHtml).toContain('data-ecommerce-category="product"')
    expect(categoryHtml).toContain('aria-pressed="true"')

    const uploadHtml = renderToStaticMarkup(createElement(EcommerceStudioUploadPanels, {
      mode,
      products: [upload('product-1')],
      references: [],
      productLimit: 3,
      batchWhite: false,
      dragOver: null,
      referenceRequired: false,
      showReferenceBlock: true,
      referenceLabel: '参考图',
      dropProps: uploadDropProps,
      onPick: async () => undefined,
      setProducts: vi.fn(),
      setReferences: vi.fn(),
      setUploadPreview: vi.fn(),
    }))
    expect(uploadHtml.startsWith('<section')).toBe(true)
    expect(uploadHtml.indexOf('data-param-section="product"'))
      .toBeLessThan(uploadHtml.indexOf('id="ecommerce-reference"'))
    expect(uploadHtml).toContain('id="ecommerce-product"')
    expect(uploadHtml).toContain('data-ecommerce-product-add')
    expect(uploadHtml).toContain('data-ecommerce-reference-add')
    expect(uploadHtml).toContain('支持 1–3 张图片，多角度效果更佳')
  })

  it('keeps common, selling and model parameter sections in their original order', () => {
    const commonHtml = renderToStaticMarkup(createElement(EcommerceStudioCommonParameters, {
      mode,
      modeOptions: {},
      platformId: 'amazon',
      orderedPlatforms: [],
      language: 'en',
      ratio: 'smart',
      resolution: 'auto',
      quality: 'auto',
      resolutionChoices: [{ value: 'auto', label: '自动' }],
      qualityChoices: [{ value: 'auto', label: '自动' }],
      showCommonFields: true,
      showPlatformAndLanguage: true,
      showLanguageField: true,
      showRatioField: true,
      showResolutionField: true,
      showQualityField: false,
      setModeOption: vi.fn(),
      setPlatformId: vi.fn(),
      setLanguage: vi.fn(),
      setRatio: vi.fn(),
      setResolution: vi.fn(),
      setQuality: vi.fn(),
    }))
    expect(commonHtml.startsWith('<section')).toBe(true)
    expect(commonHtml).toContain('data-param-section="common"')
    expect(commonHtml).toContain('data-ecommerce-platform')
    expect(commonHtml).toContain('data-ecommerce-language')
    expect(commonHtml).toContain('data-ecommerce-ratio')
    expect(commonHtml).toContain('data-ecommerce-resolution')

    const hiddenSelling = renderToStaticMarkup(createElement(EcommerceStudioSellingPointsPanel, {
      visible: false,
      note: '',
      writingSellingPoints: false,
      chatTargetLabel: '',
      sellingPointsError: '',
      onWriteSellingPoints: async () => undefined,
      onNoteChange: vi.fn(),
    }))
    expect(hiddenSelling).toBe('')

    const sellingHtml = renderToStaticMarkup(createElement(EcommerceStudioSellingPointsPanel, {
      visible: true,
      note: '防水',
      writingSellingPoints: false,
      chatTargetLabel: '',
      sellingPointsError: '生成失败',
      onWriteSellingPoints: async () => undefined,
      onNoteChange: vi.fn(),
    }))
    expect(sellingHtml.startsWith('<section')).toBe(true)
    expect(sellingHtml).toContain('data-param-section="selling"')
    expect(sellingHtml).toContain('id="ecommerce-note"')
    expect(sellingHtml).toContain('disabled=""')
    expect(sellingHtml).toContain('data-ecommerce-ai-write-error')

    const modelHtml = renderToStaticMarkup(createElement(EcommerceStudioModelFields, {
      mode,
      modeOptions: {},
      chatModels: ['chat-model'],
      intentModel: '',
      chatTargetLabel: 'chat-model',
      model: 'image-model',
      onGenerateModelChange: vi.fn(),
      models: ['image-model'],
      videoModels: [],
      setModeOption: vi.fn(),
      toggleModeOption: vi.fn(),
    }))
    expect(modelHtml.indexOf('data-param-section="plan-model"'))
      .toBeLessThan(modelHtml.indexOf('data-param-section="generate-model"'))
    expect(modelHtml.indexOf('data-param-section="generate-model"'))
      .toBeLessThan(modelHtml.indexOf('data-param-section="mode"'))
    expect(modelHtml).toContain('data-ecommerce-intent-model')
    expect(modelHtml).toContain('data-ecommerce-model')
  })

  it('keeps the result mode bar, empty state and failed-result action anchors', () => {
    const categoryModes = STUDIO_MODES.filter((item) => item.category === 'product')
    const emptyHtml = renderToStaticMarkup(createElement(EcommerceStudioResultsPane, {
      mode,
      usage: mode.usage,
      categoryModes,
      products: [],
      visibleResults: [],
      carouselCases: studioCarouselCases(mode),
      running: false,
      onActivateMode: vi.fn(),
    }))
    expect(emptyHtml.startsWith('<section')).toBe(true)
    expect(emptyHtml).toContain('data-ecommerce-modes')
    expect(emptyHtml).toContain('data-ecommerce-empty')
    expect(emptyHtml).toContain('data-ecommerce-case-carousel')

    const resultHtml = renderToStaticMarkup(createElement(EcommerceStudioResultsPane, {
      mode,
      usage: mode.usage,
      categoryModes,
      products: [],
      visibleResults: [{
        nodeId: 'failed-1',
        status: 'failed',
        recovery: 'retry-save',
        error: '保存失败',
        onRetrySave: vi.fn(),
        onRemoveFailed: vi.fn(),
      }],
      carouselCases: studioCarouselCases(mode),
      longImageNode: createElement('div', { 'data-long-image': true }),
      running: true,
      onActivateMode: vi.fn(),
    }))
    expect(resultHtml).toContain('data-ecommerce-grid')
    expect(resultHtml).toContain('data-ecommerce-retry-save="failed-1"')
    expect(resultHtml).toContain('data-ecommerce-remove-failed="failed-1"')
    expect(resultHtml).toContain('disabled=""')
    expect(resultHtml).toContain('data-long-image="true"')
  })

  it('keeps result detail and compare dialogs as sibling view roots', () => {
    const result = {
      nodeId: 'result-1',
      status: 'done' as const,
      prompt: '保留产品',
      ratio: '1:1',
      sourcePreview: preview('source'),
      preview: preview('result'),
    }
    const html = renderToStaticMarkup(createElement(EcommerceStudioResultDetailDialogs, {
      detailTarget: result,
      compareTarget: result,
      onCloseDetail: vi.fn(),
      onCopyPrompt: vi.fn(),
      onCloseCompare: vi.fn(),
    }))
    expect(html.startsWith('<div')).toBe(true)
    expect(html.indexOf('data-ecommerce-result-detail-dialog'))
      .toBeLessThan(html.indexOf('data-ecommerce-compare-dialog'))
    expect(html).toContain('aria-labelledby="ecommerce-result-detail-title"')
    expect(html).toContain('data-ecommerce-result-prompt-copy')
    expect(html).toContain('data-ecommerce-compare-source-image')
    expect(html).toContain('data-ecommerce-compare-result-image')
  })

  it('keeps batch and single-result edit dialogs separate and in order', () => {
    const html = renderToStaticMarkup(createElement(EcommerceStudioEditDialogs, {
      batchEditOpen: true,
      selectedImageEditCount: 2,
      editPresets: [{ key: 'clean', label: '清理', instruction: '清理杂物' }],
      batchInstruction: '',
      batchEditError: '',
      batchReference: upload('batch-reference'),
      batchReferenceBusy: false,
      editModels: ['edit-model'],
      batchEditModel: '',
      batchEditSubmitting: false,
      running: false,
      editTarget: { nodeId: 'result-1', label: '这张结果' },
      editInstruction: '',
      editError: '',
      editReference: upload('edit-reference'),
      editReferenceBusy: false,
      editModel: '',
      editSubmitting: false,
      onBatchInstructionChange: vi.fn(),
      onBatchPreset: vi.fn(),
      onPickBatchReference: async () => undefined,
      onRemoveBatchReference: vi.fn(),
      onBatchModelChange: vi.fn(),
      onBatchCancel: vi.fn(),
      onBatchSubmit: async () => undefined,
      onEditInstructionChange: vi.fn(),
      onEditPreset: vi.fn(),
      onPickEditReference: async () => undefined,
      onRemoveEditReference: vi.fn(),
      onEditModelChange: vi.fn(),
      onEditCancel: vi.fn(),
      onEditSubmit: async () => undefined,
    }))
    expect(html.startsWith('<div')).toBe(true)
    expect(html.indexOf('data-ecommerce-batch-edit-dialog'))
      .toBeLessThan(html.indexOf('data-ecommerce-edit-dialog'))
    expect(html).toContain('for="ecommerce-batch-edit-reference"')
    expect(html).toContain('for="ecommerce-edit-reference"')
    expect(html).toContain('data-ecommerce-batch-edit-model')
    expect(html).toContain('data-ecommerce-edit-model')
    expect(html).toContain('生成 2 张编辑结果')
  })

  it('keeps upscale, upload preview and generation confirmation anchors', () => {
    const upscaleHtml = renderToStaticMarkup(createElement(EcommerceStudioUpscaleDialog, {
      upscaleTarget: { items: [{ nodeId: 'result-1', status: 'done' }], batch: false },
      availableUpscaleOptions: availableStudioUpscaleOptions(undefined),
      upscaleProfile: 'standard',
      upscaleScale: '4x',
      upscaleError: '超清失败',
      upscaleSubmitting: true,
      running: false,
      onProfileChange: vi.fn(),
      onScaleChange: vi.fn(),
      onCancel: vi.fn(),
      onSubmit: async () => undefined,
    }))
    expect(upscaleHtml.startsWith('<div')).toBe(true)
    expect(upscaleHtml).toContain('data-ecommerce-upscale-dialog')
    expect(upscaleHtml).toContain('data-ecommerce-upscale-profile')
    expect(upscaleHtml).toContain('data-ecommerce-upscale-scale')
    expect(upscaleHtml).toContain('data-ecommerce-upscale-error')

    const previewHtml = renderToStaticMarkup(createElement(EcommerceStudioUploadPreviewDialog, {
      uploadPreviewItem: upload('preview-1'),
      uploadPreviewIndex: 0,
      uploadPreviewCount: 1,
      onClose: vi.fn(),
      onPrevious: vi.fn(),
      onNext: vi.fn(),
    }))
    expect(previewHtml).toContain('data-ecommerce-upload-lightbox')
    expect(previewHtml).toContain('data-ecommerce-upload-position')
    expect(previewHtml.match(/disabled=""/g)).toHaveLength(2)

    const confirmHtml = renderToStaticMarkup(createElement(EcommerceStudioGenerateConfirmDialog, {
      confirming: true,
      mode,
      batchOutputCount: 8,
      usage: mode.usage,
      ratio: 'smart',
      platform: null,
      confirmUsesAiPlan: true,
      onCancel: vi.fn(),
      onConfirm: async () => undefined,
    }))
    expect(confirmHtml.startsWith('<div')).toBe(true)
    expect(confirmHtml).toContain('data-ecommerce-confirm')
    expect(confirmHtml).toContain('data-ecommerce-confirm-ai-flow')
    expect(confirmHtml).toContain('data-ecommerce-confirm-cancel')
    expect(confirmHtml).toContain('data-ecommerce-confirm-ok')
  })
})
