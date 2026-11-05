import {
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
import { ECOMMERCE_PLATFORMS } from '../../domain/ecommerce/platforms'
import {
  ecommerceLanguageOptionLabel,
  ecommerceLanguageOptions,
  ecommerceRatioLabel,
  ecommerceRatioOptions,
  usageLabel,
  type EcommerceLanguage,
  type EcommerceModeOptions,
  type EcommerceRequest,
  type EcommerceUsage,
} from '../../domain/ecommerce/types'
import type {
  EcommerceUpscaleProfile,
  EcommerceUpscaleScale,
} from '../../domain/ecommerce/upscale'
import { ECOMMERCE_NOTE_MAX } from '../../domain/ecommerce/prompt'
import {
  defaultEcommerceModeOptions,
  modeOptionString,
  normalizeEcommerceModeOptions,
} from '../../domain/ecommerce/modeOptions'
import type { EcommerceModeFormState } from '../../domain/ecommerce/draft'
import { ECOMMERCE_UPSCALE_SCALES } from '../../domain/ecommerce/upscale'
import { EcommerceSelect } from './EcommerceSelect'
import { styles } from './studio/studioStyles'
import {
  DEFAULT_MODE_FORM_STATE,
  STUDIO_CATEGORIES,
  STUDIO_MODES,
  type StudioCategory,
  type StudioMode,
  type EcommerceResultItem,
  type EcommerceUpload,
  type EcommerceStudioProps,
} from './studio/studioContracts'
import { GenerationStageView, ResultStatusOverlay } from './studio/EcommerceStudioStatusViews'
import { CategoryGlyph, modelIconFor } from './studio/studioSharedViews'
import { ModeSpecificParameters } from './studio/EcommerceStudioModeParameters'
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
} from './studio/controller/studioFormProjection'
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
} from './studio/controller/studioRequestCoordinator'
import {
  availableStudioUpscaleOptions,
  runStudioUpscale,
  studioBatchEditFailureMessage,
  studioBatchEditSubmission,
  studioEditFailureMessage,
  studioEditSubmission,
  studioUploadFailureMessage,
  studioUploadPreviewItems,
  studioUploadPreviewStep,
} from './studio/controller/studioResultActionCoordinator'

export type {
  EcommerceUpload,
  EcommerceImageParamOptions,
  EcommerceResultItem,
  EcommerceLongImageTools,
  EcommerceStudioProps,
} from './studio/studioContracts'
export { GenerationStageView, ResultStatusOverlay }

export function EcommerceStudio({
  initialDraft = null,
  initialProducts = [],
  initialReferences = [],
  onDraftChange,
  platforms = ECOMMERCE_PLATFORMS,
  onUpload,
  onWriteSellingPoints,
  onGenerate,
  onEditResult,
  onEditResults,
  onUpscaleResult,
  upscaleProfiles,
  models = [],
  videoModels = [],
  imageParamOptionsByModel = {},
  editModels = [],
  model,
  onModelChange,
  running,
  results,
  workbench,
  longImage,
  chatTargetLabel = '',
  chatModels = [],
  intentModel = '',
  onIntentModelChange,
  onConfigureChannels,
  generationStage = null,
  textRecordWarning = '',
}: EcommerceStudioProps) {
  const initial = useMemo(() => initialStudioFormState(initialDraft), [initialDraft])
  const initialMode = initial.initialMode
  const [category, setCategory] = useState<StudioCategory>(initial.category)
  const [modeId, setModeId] = useState(initial.modeId)
  const videoDuration = initial.videoDuration
  const [usage, setUsage] = useState<EcommerceUsage>(initial.usage)
  const [modeStates, setModeStates] = useState<Record<string, EcommerceModeFormState>>(
    () => initial.modeStates,
  )
  const [modeOptionsByMode, setModeOptionsByMode] = useState<
    Record<string, EcommerceModeOptions>
  >(() => initial.modeOptionsByMode)
  const [products, setProducts] = useState<EcommerceUpload[]>([...initialProducts])
  const [references, setReferences] = useState<EcommerceUpload[]>([...initialReferences])
  /** 二次确认：点生成先算出"预计 N 张"，确认后才真的发请求（#384 的 D6） */
  const [confirming, setConfirming] = useState(false)
  const [uploadPreview, setUploadPreview] = useState<{
    kind: 'product' | 'reference'
    index: number
  } | null>(null)
  const [error, setError] = useState('')
  const [writingSellingPoints, setWritingSellingPoints] = useState(false)
  const [sellingPointsError, setSellingPointsError] = useState('')
  /** 结果卡上的定向 AI 编辑：一次只打开一张，指令不进入左侧表单草稿 */
  const [editTarget, setEditTarget] = useState<{ nodeId: string; label: string } | null>(null)
  const [editInstruction, setEditInstruction] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editError, setEditError] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editReference, setEditReference] = useState<EcommerceUpload | null>(null)
  const [editReferenceBusy, setEditReferenceBusy] = useState(false)
  const [selectedEditNodes, setSelectedEditNodes] = useState<Set<string>>(() => new Set())
  const [batchEditOpen, setBatchEditOpen] = useState(false)
  const [batchInstruction, setBatchInstruction] = useState('')
  const [batchEditModel, setBatchEditModel] = useState('')
  const [batchEditError, setBatchEditError] = useState('')
  const [batchEditSubmitting, setBatchEditSubmitting] = useState(false)
  const [batchReference, setBatchReference] = useState<EcommerceUpload | null>(null)
  const [batchReferenceBusy, setBatchReferenceBusy] = useState(false)
  const [compareTarget, setCompareTarget] = useState<EcommerceResultItem | null>(null)
  const [detailTarget, setDetailTarget] = useState<EcommerceResultItem | null>(null)
  const selectedImageEditCount = 0
  const [upscaleTarget, setUpscaleTarget] = useState<{
    items: readonly EcommerceResultItem[]
    batch: boolean
  } | null>(null)
  const [upscaleProfile, setUpscaleProfile] = useState<EcommerceUpscaleProfile>('standard')
  const [upscaleScale, setUpscaleScale] = useState<EcommerceUpscaleScale>('4x')
  const [upscaleSubmitting, setUpscaleSubmitting] = useState(false)
  const [upscaleError, setUpscaleError] = useState('')
  const availableUpscaleOptions = useMemo(
    () => availableStudioUpscaleOptions(upscaleProfiles),
    [upscaleProfiles],
  )

  const uploadPreviewItems = studioUploadPreviewItems(uploadPreview, products, references)
  const uploadPreviewItem = uploadPreview ? uploadPreviewItems[uploadPreview.index] ?? null : null

  useEffect(() => {
    if (!uploadPreview) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setUploadPreview(null)
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setUploadPreview((current) =>
          studioUploadPreviewStep(current, -1, uploadPreviewItems.length),
        )
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setUploadPreview((current) =>
          studioUploadPreviewStep(current, 1, uploadPreviewItems.length),
        )
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [uploadPreview, uploadPreviewItems.length])

  const openEditForResult = (result: EcommerceResultItem) => {
    if (!onEditResult || running || result.mime?.startsWith('video/')) return
    setEditTarget({ nodeId: result.nodeId, label: '这张结果' })
    setEditInstruction(note.trim())
    setEditModel('')
    setEditReference(null)
    setEditError('')
  }

  const openUpscaleForResult = (result: EcommerceResultItem) => {
    if (!onUpscaleResult || running || result.mime?.startsWith('video/')) return
    const first = availableUpscaleOptions[0]
    if (!first) return
    setUpscaleTarget({ items: [result], batch: false })
    setUpscaleProfile(first.id)
    setUpscaleScale('4x')
    setUpscaleError('')
  }

  const longImageNode = longImage?.({
    busy: running,
    ...(onEditResult ? {
      editResult: (nodeId: string) => {
        const result = results.find((item) => item.nodeId === nodeId)
        if (result) openEditForResult(result)
      },
    } : {}),
    ...(onUpscaleResult && availableUpscaleOptions.length > 0 ? {
      upscaleResult: (nodeId: string) => {
        const result = results.find((item) => item.nodeId === nodeId)
        if (result) openUpscaleForResult(result)
      },
    } : {}),
  })
  /**
   * 正在往哪一块拖（对账 #427）：`null` = 没在拖。只用来画一个"松手会落这儿"的提示 ——
   * 没有提示的话，用户拖着图悬在框上不知道能不能放（画布那边早就有拖放，
   * 电商这两块一直没有：同一个应用里两种手感，是很容易被当成"坏了"的那种不一致）。
   */
  const [dragOver, setDragOver] = useState<'product' | 'reference' | null>(null)
  const formProjection = useMemo(() => projectStudioForm({
    modeId,
    category,
    fallbackMode: initialMode,
    modeStates,
    modeOptionsByMode,
    products,
    results,
  }), [
    modeId,
    category,
    initialMode,
    modeStates,
    modeOptionsByMode,
    products,
    results,
  ])
  const {
    mode,
    modeFormState,
    modeOptions,
    effectiveCount,
    batchWhite,
    productLimit,
    batchOutputCount,
    categoryModes,
    visibleResults,
  } = formProjection
  const platformId = modeFormState.platformId
  const language = modeFormState.language
  const ratio = modeFormState.ratio
  const resolution = modeFormState.resolution
  const quality = modeFormState.quality
  const note = modeFormState.note
  const updateModeFormState = (patch: Partial<EcommerceModeFormState>) => {
    setModeStates((current) => applyModeFormPatch(current, mode, patch))
  }
  const setPlatformId = (value: string) => updateModeFormState({ platformId: value })
  const setLanguage = (value: EcommerceLanguage) => updateModeFormState({ language: value })
  const setRatio = (value: string) => updateModeFormState({ ratio: value })
  const setResolution = (value: string) => updateModeFormState({ resolution: value })
  const setQuality = (value: string) => updateModeFormState({ quality: value })
  const setNote = (value: string) => updateModeFormState({ note: value })
  const setModeOptions = (next: EcommerceModeOptions) => {
    setModeOptionsByMode((current) => ({
      ...current,
      [mode.id]: normalizeEcommerceModeOptions(next),
    }))
  }
  const setModeOption = (key: string, value: string | string[] | Record<string, number>) => {
    setModeOptions(setStudioModeOption(modeOptions, key, value))
  }
  const toggleModeOption = (key: string, id: string) => {
    const next = toggleStudioModeOption(modeOptions, key, id)
    setModeOptions(next)
  }

  useEffect(() => {
    setSelectedEditNodes((current) => pruneSelectedEditNodes(current, results))
  }, [results])

  /**
   * 把当前表单回给页面落库。
   *
   * 只回传**可序列化**的节点 id 与参数，不回传 React 预览节点；
   * `model` 由页面控制，所以这里读 props 的最新值。
   */
  useEffect(() => {
    onDraftChange?.(studioFormDraft({
      mode,
      videoDuration,
      usage,
      modeFormState,
      effectiveCount,
      model,
      modeOptions,
      modeStates,
      products,
      references,
    }))
  }, [
    usage,
    mode,
    videoDuration,
    platformId,
    language,
    effectiveCount,
    ratio,
    resolution,
    quality,
    note,
    model,
    modeOptions,
    modeFormState,
    modeStates,
    products,
    references,
    onDraftChange,
  ])

  const platform = useMemo(
    () => platforms.find((p) => p.id === platformId) ?? null,
    [platforms, platformId],
  )
  const orderedPlatforms = useMemo(() => {
    return orderedStudioPlatforms(platforms)
  }, [platforms])

  const activateMode = (next: StudioMode) => {
    const previousKind = mode.mediaKind
    setModeId(next.id)
    setCategory(next.category)
    setUsage(next.usage)
    setModeOptionsByMode((current) =>
      ensureStudioModeState(current, next, defaultEcommerceModeOptions(next.id)),
    )
    setModeStates((current) =>
      ensureStudioModeState(current, next, DEFAULT_MODE_FORM_STATE(next)),
    )
    if (previousKind !== next.mediaKind) onModelChange('')
    setError('')
  }

  const activateCategory = (next: StudioCategory) => {
    const first = STUDIO_MODES.find((item) => item.category === next)
    if (first) activateMode(first)
  }

  const onPick = async (file: File | undefined, kind: 'product' | 'reference') => {
    if (!file) return
    setError('')
    const uploaded = await onUpload(file, kind)
    if (!uploaded) {
      setError(`这张图没能读进来（格式不支持或读取失败），换一张再试`)
      return
    }
    if (kind === 'product') {
      setProducts((prev) => appendProductUpload(prev, uploaded, {
        batchWhite,
        productLimit,
        productCount: prev.length,
        referenceCount: references.length,
      }))
    } else {
      setReferences((prev) => appendReferenceUpload(prev, uploaded, products.length))
    }
  }

  /**
   * **拖进来的文件**（对账 #427）。
   *
   * 两条与文件选择保持一致的规矩（两条路各写一套迟早分叉）：
   * - 走的是**同一个** `onPick`（所以"不是图 / 读不出来"的提示也是同一句话）；
   * - 参考图仍然**最多 4 张**：放不下的一次**不收**，也不偷偷挤掉已有的。
   */
  const onDropFiles = (kind: 'product' | 'reference', files: FileList | null) => {
    setDragOver(null)
    const picked = [...(files ?? [])]
    if (picked.length === 0) return
    void (async () => {
      if (kind === 'product') {
        const room = uploadRoom('product', {
          batchWhite,
          productLimit,
          productCount: products.length,
          referenceCount: references.length,
        })
        for (const file of picked.slice(0, room)) await onPick(file, 'product')
        return
      }
      const room = uploadRoom('reference', {
        batchWhite,
        productLimit,
        productCount: products.length,
        referenceCount: references.length,
      })
      for (const f of picked.slice(0, room)) await onPick(f, 'reference')
    })()
  }

  const pickEditReference = async (file: File | undefined, batch: boolean) => {
    if (!file) return
    if (batch) {
      setBatchReferenceBusy(true)
      setBatchEditError('')
    } else {
      setEditReferenceBusy(true)
      setEditError('')
    }
    try {
      const uploaded = await onUpload(file, 'reference')
      if (!uploaded) {
        const message = studioUploadFailureMessage()
        if (batch) setBatchEditError(message)
        else setEditError(message)
        return
      }
      if (batch) setBatchReference(uploaded)
      else setEditReference(uploaded)
    } finally {
      if (batch) setBatchReferenceBusy(false)
      else setEditReferenceBusy(false)
    }
  }

  /** 拖放的四个处理器：两块上传区共用（`kind` 决定落到哪儿） */
  const dropProps = (kind: 'product' | 'reference') => ({
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault()
      setDragOver(kind)
    },
    /* 指针在同一位块的子元素之间移动也会触发 dragleave ⇒ 先看还在不在里面 */
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDragOver((cur) => (cur === kind ? null : cur))
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault()
      onDropFiles(kind, e.dataTransfer?.files ?? null)
    },
  })

  const buildRequest = (): EcommerceRequest => buildStudioRequest({
    mode,
    modeOptions,
    usage,
    form: modeFormState,
    effectiveCount,
    videoDuration,
    products,
    references,
    model,
  })

  const writeSellingPoints = async () => {
    if (!onWriteSellingPoints) return
    setWritingSellingPoints(true)
    setSellingPointsError('')
    try {
      const text = (await onWriteSellingPoints(buildRequest())).trim()
      if (!text) throw new Error('模型没有返回可用的卖点文案')
      setNote(text.slice(0, ECOMMERCE_NOTE_MAX))
    } catch (e) {
      setSellingPointsError(sellingPointFailureMessage(e))
    } finally {
      setWritingSellingPoints(false)
    }
  }

  const start = () => {
    const request = buildRequest()
    const validationError = validateStudioStart({
      mode,
      modeOptions,
      products,
      references,
      effectiveCount,
      batchWhite,
      chatTargetLabel,
      request,
    })
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    setConfirming(true)
  }

  const editPresets = useMemo(
    () => studioEditPresets(language, usage, ecommerceLanguageOptionLabel),
    [language, usage],
  )
  const confirm = async () => {
    setConfirming(false)
    setError('')
    try {
      await submitStudioGeneration({
        batchWhite,
        products,
        request: buildRequest(),
        onGenerate,
      })
    } catch (e) {
      setError(uploadFailureMessage(e))
    }
  }

  const submitEdit = async () => {
    if (!editTarget || !onEditResult) return
    const submission = studioEditSubmission(editInstruction, editReference, editModel)
    if ('error' in submission) {
      setEditError(submission.error)
      return
    }
    setEditError('')
    setEditSubmitting(true)
    try {
      await onEditResult(
        editTarget.nodeId,
        submission.instruction,
        submission.options,
      )
      setEditTarget(null)
      setEditInstruction('')
      setEditReference(null)
      setEditModel('')
    } catch (e) {
      setEditError(studioEditFailureMessage(e))
    } finally {
      setEditSubmitting(false)
    }
  }

  const submitUpscale = async () => {
    if (!upscaleTarget?.items.length || !onUpscaleResult) return
    setUpscaleError('')
    setUpscaleSubmitting(true)
    const progress = await runStudioUpscale({
      items: upscaleTarget.items,
      profile: upscaleProfile,
      scale: upscaleScale,
      onUpscale: onUpscaleResult,
    })
    if (!progress.error) {
      if (upscaleTarget.batch) setSelectedEditNodes(new Set())
      setUpscaleTarget(null)
    } else {
      setUpscaleError(progress.error)
    }
    setUpscaleSubmitting(false)
  }

  const submitBatchEdit = async () => {
    if (!onEditResults) return
    const submission = studioBatchEditSubmission({
      instruction: batchInstruction,
      results,
      selectedNodeIds: selectedEditNodes,
      reference: batchReference,
      model: batchEditModel,
    })
    if ('error' in submission) {
      setBatchEditError(submission.error)
      return
    }
    setBatchEditError('')
    setBatchEditSubmitting(true)
    try {
      await onEditResults(
        submission.imageNodeIds,
        submission.instruction,
        submission.options,
      )
      setBatchEditOpen(false)
      setBatchInstruction('')
      setBatchReference(null)
      setBatchEditModel('')
      setSelectedEditNodes(new Set())
    } catch (e) {
      setBatchEditError(studioBatchEditFailureMessage(e))
    } finally {
      setBatchEditSubmitting(false)
    }
  }

  const { resolutionChoices, qualityChoices } = studioImageParameterChoices(
    imageParamOptionsByModel,
    model,
  )
  const {
    referenceRequired,
    showReferenceBlock,
    referenceLabel,
    showCommonFields,
    showSellingPoints,
    showPlatformAndLanguage,
    showLanguageField,
    showRatioField,
    showResolutionField,
    showQualityField,
  } = studioFieldVisibility(mode, qualityChoices)
  const handleGenerateModelChange = (next: string) => {
    onModelChange(next)
    updateModeFormState(nextModeFormAfterModelChange(
      imageParamOptionsByModel,
      next,
      { resolution, quality },
    ))
  }
  const carouselCases = studioCarouselCases(mode)
  const confirmUsesAiPlan = usesAiPlan(confirming, chatTargetLabel, buildRequest())

  return (
    <div className={styles.wrap} data-ecommerce-studio>
      <aside className={styles.categoryRail} data-ecommerce-categories>
        {STUDIO_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === category
                ? `${styles.categoryButton} ${styles.categoryButtonOn}`
                : styles.categoryButton
            }
            data-ecommerce-category={item.id}
            aria-pressed={item.id === category}
            onClick={() => activateCategory(item.id)}
          >
            <CategoryGlyph category={item.id} />
            <span>{item.label}</span>
          </button>
        ))}
      </aside>

      {/* 右：参数 */}
      <aside className={styles.form} data-ecommerce-form>
        <div className={styles.formScroll} data-ecommerce-param-mode={mode.id}>
        <section
          className={dragOver === 'product' ? `${styles.block} ${styles.blockDrop}` : styles.block}
          data-ecommerce-product-drop={dragOver === 'product' ? 'true' : 'false'}
          data-param-section="product"
          {...dropProps('product')}
        >
          <div className={styles.blockHead}>
            <label className={styles.blockTitle} htmlFor="ecommerce-product">
              商品原图
            </label>
            <span className={styles.hint} data-ecommerce-product-hint>
              {batchWhite
                ? `支持 1–12 张源图；每张按上方角度独立生成，最多 36 张输出`
                : '支持 1–3 张图片，多角度效果更佳'}
            </span>
          </div>
          <input
            id="ecommerce-product"
            className={styles.file}
            type="file"
            accept="image/*"
            multiple
            data-ecommerce-product-input
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              void (async () => {
                for (const file of files) await onPick(file, 'product')
              })()
              e.currentTarget.value = ''
            }}
          />
          <div className={styles.slotRow}>
            {products.map((item, index) => (
              <div key={item.nodeId} className={styles.slot} data-ecommerce-product-preview>
                <button
                  type="button"
                  className={styles.slotPreview}
                  data-ecommerce-product-open={index}
                  aria-label={`放大预览第 ${index + 1} 张商品图`}
                  onClick={() => setUploadPreview({ kind: 'product', index })}
                >
                  {item.preview}
                </button>
                <button
                  type="button"
                  className={styles.slotRemove}
                  aria-label={`移除第 ${index + 1} 张产品图`}
                  onClick={() => setProducts((prev) => prev.filter((row) => row.nodeId !== item.nodeId))}
                >
                  ×
                </button>
              </div>
            ))}
            {products.length === 0 ? (
              <label className={styles.emptySlot} htmlFor="ecommerce-product">
                <span className={styles.uploadPlus}>+</span>
                <span>上传图片</span>
              </label>
            ) : products.length < productLimit &&
              (batchWhite || products.length + references.length < 4) ? (
              <label className={styles.addSlot} htmlFor="ecommerce-product" data-ecommerce-product-add>
                +
              </label>
            ) : null}
          </div>
        </section>

        {showReferenceBlock ? (
          <section
            className={
              dragOver === 'reference' ? `${styles.block} ${styles.blockDrop}` : styles.block
            }
            data-ecommerce-reference-drop={dragOver === 'reference' ? 'true' : 'false'}
            {...dropProps('reference')}
          >
            <div className={styles.blockHead}>
              <label className={styles.blockTitle} htmlFor="ecommerce-reference">
                {referenceLabel}
              </label>
              <span className={styles.hint}>{referenceRequired ? '必填' : '选填'}</span>
            </div>
            <input
              id="ecommerce-reference"
              className={styles.file}
              type="file"
              accept={mode.id === 'video-recreate' ? 'video/*,image/*' : 'image/*'}
              multiple={mode.id !== 'video-recreate'}
              data-ecommerce-reference-input
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                void (async () => {
                  for (const f of files) await onPick(f, 'reference')
                })()
              }}
            />
            <div className={styles.slotRow}>
              {references.map((r) => (
                <div key={r.nodeId} className={styles.slot} data-ecommerce-reference-preview>
                  <button
                    type="button"
                    className={styles.slotPreview}
                    data-ecommerce-reference-open={references.indexOf(r)}
                    aria-label="放大预览参考图"
                    onClick={() =>
                      setUploadPreview({ kind: 'reference', index: references.indexOf(r) })
                    }
                  >
                    {r.preview}
                  </button>
                  <button
                    type="button"
                    className={styles.slotRemove}
                    aria-label="移除参考图"
                    onClick={() =>
                      setReferences((prev) => prev.filter((row) => row.nodeId !== r.nodeId))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {references.length + products.length < 4 ? (
                <label
                  className={styles.addSlot}
                  htmlFor="ecommerce-reference"
                  data-ecommerce-reference-add
                >
                  +
                </label>
              ) : null}
            </div>
            {referenceRequired && references.length === 0 ? (
              <p className={styles.hint} data-ecommerce-recreate-hint>
                {mode.id === 'video-recreate'
                  ? '先上传参考视频，再生成同款视频。'
                  : mode.id === 'wear-tryon'
                    ? '先上传人物参考图，服装和人物都会以素材为准。'
                    : '先上传爆款参考图，产品主体仍以商品原图为准。'}
              </p>
            ) : null}
          </section>
        ) : null}

        {showCommonFields ? (
        <section className={styles.block} data-param-section="common">
          <div className={styles.twoCols}>
            {showPlatformAndLanguage && mode.mediaKind === 'video' ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>市场地区</span>
                <EcommerceSelect
                  ariaLabel="市场地区"
                  name="market-region"
                  value={modeOptionString(modeOptions, 'marketRegion', 'us')}
                  onChange={(value) => setModeOption('marketRegion', value)}
                  options={[
                    { value: 'us', label: '美国' },
                    { value: 'uk', label: '英国' },
                    { value: 'eu', label: '欧洲' },
                    { value: 'sea', label: '东南亚' },
                    { value: 'me', label: '中东' },
                  ]}
                  dataAttributes={{ 'data-ecommerce-market-region': true }}
                />
              </div>
            ) : showPlatformAndLanguage ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>上架平台</span>
                <EcommerceSelect
                  ariaLabel="上架平台"
                  name="platform"
                  value={platformId}
                  onChange={setPlatformId}
                  options={[
                    { value: '', label: '不指定（通用）' },
                    ...orderedPlatforms.map((platform) => ({
                      value: platform.id,
                      label: platform.name,
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-platform': true }}
                />
              </div>
            ) : null}
            {showLanguageField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>语言</span>
                <EcommerceSelect
                  ariaLabel="输出语言"
                  name="language"
                  value={language}
                  onChange={(value) => setLanguage(value as EcommerceLanguage)}
                  options={ecommerceLanguageOptions(mode.usage)}
                  dataAttributes={{ 'data-ecommerce-language': true }}
                />
              </div>
            ) : null}
            {showRatioField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>
                  {mode.mediaKind === 'video' ? '视频比例' : '图片比例'}
                </span>
                <EcommerceSelect
                  ariaLabel={mode.mediaKind === 'video' ? '视频比例' : '图片比例'}
                  name="ratio"
                  value={ratio}
                  onChange={setRatio}
                  options={ecommerceRatioOptions(mode.usage, mode.mediaKind)}
                  dataAttributes={{ 'data-ecommerce-ratio': true }}
                />
              </div>
            ) : null}
            {showResolutionField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>分辨率</span>
                <EcommerceSelect
                  ariaLabel="图片分辨率"
                  name="resolution"
                  value={resolution}
                  onChange={setResolution}
                  options={resolutionChoices}
                  dataAttributes={{ 'data-ecommerce-resolution': true }}
                />
              </div>
            ) : null}
            {showQualityField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>质量</span>
                <EcommerceSelect
                  ariaLabel="图片质量"
                  name="quality"
                  value={quality}
                  onChange={setQuality}
                  options={qualityChoices}
                  dataAttributes={{ 'data-ecommerce-quality': true }}
                />
              </div>
            ) : null}
          </div>
        </section>
        ) : null}

        {showSellingPoints ? (
        <section className={styles.block} data-param-section="selling">
          <div className={styles.blockHead}>
            <label className={styles.blockTitle} htmlFor="ecommerce-note">
              商品卖点 &amp; 要求
            </label>
            <button
              type="button"
              className={styles.aiWrite}
              data-ecommerce-ai-write
              disabled={writingSellingPoints || !chatTargetLabel}
              onClick={() => void writeSellingPoints()}
            >
              {writingSellingPoints ? '生成中…' : 'AI 帮写'}
            </button>
          </div>
          <textarea
            id="ecommerce-note"
            className={styles.textarea}
            value={note}
            maxLength={ECOMMERCE_NOTE_MAX}
            placeholder="例：突出防水材质；模特手持场景；不要出现文字"
            data-ecommerce-note
            onChange={(e) => setNote(e.target.value)}
          />
          {sellingPointsError ? (
            <p className={styles.error} role="alert" data-ecommerce-ai-write-error>
              {sellingPointsError}
            </p>
          ) : null}
        </section>
        ) : null}

        {mode.id !== 'product-white' ? (
        <div className={styles.field} data-param-section="plan-model">
          <span className={styles.fieldHead}>
            <span className={styles.fieldLabel}>对话模型</span>
            {onConfigureChannels ? (
              <button
                type="button"
                className={styles.fieldAction}
                data-ecommerce-configure-channels
                onClick={onConfigureChannels}
              >
                模型服务
              </button>
            ) : null}
          </span>
          <EcommerceSelect
            ariaLabel="对话模型"
            name="intent-model"
            value={
              (chatModels.includes(intentModel) ? intentModel : undefined) ??
              (chatTargetLabel && chatModels.includes(chatTargetLabel)
                ? chatTargetLabel
                : undefined) ??
              chatModels[0] ??
              ''
            }
            onChange={(value) => onIntentModelChange?.(value)}
            placeholder="未配置对话模型"
            menuMinWidth={260}
            disabled={chatModels.length === 0}
            options={chatModels.map((item) => ({
              value: item,
              label: item,
              icon: modelIconFor(item),
            }))}
            dataAttributes={{ 'data-ecommerce-intent-model': true }}
          />
        </div>
        ) : null}

        <div className={styles.field} data-param-section="generate-model">
          <span className={styles.fieldLabel}>
            {mode.mediaKind === 'video' ? '视频模型' : '生成模型'}
          </span>
          <EcommerceSelect
            ariaLabel={mode.mediaKind === 'video' ? '视频模型' : '生成模型'}
            name="generate-model"
            value={model}
            onChange={handleGenerateModelChange}
            placeholder="默认（按渠道解析）"
            menuMinWidth={250}
            options={[
              { value: '', label: '默认（按渠道解析）' },
              ...(mode.mediaKind === 'video' ? videoModels : models).map((item) => ({
                value: item,
                label: item,
                icon: modelIconFor(item),
              })),
            ]}
            dataAttributes={{ 'data-ecommerce-model': true }}
          />
        </div>

        <div data-param-section="mode">
          <ModeSpecificParameters
            modeId={mode.id}
            options={modeOptions}
            setOption={setModeOption}
            toggleOption={toggleModeOption}
          />
        </div>

        </div>

        {error ? (
          <p className={styles.error} role="alert" data-ecommerce-error>
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className={styles.generate}
          disabled={running}
          data-ecommerce-generate
          onClick={start}
        >
          {running ? '生成中…' : mode.mediaKind === 'video' ? '生成视频' : `生成${mode.label}`}
        </button>
        <GenerationStageView stage={generationStage} />
        {textRecordWarning ? (
          <p className={styles.error} role="alert" data-ecommerce-record-warning>
            {textRecordWarning}
          </p>
        ) : null}

      </aside>

      {/* 中：产物 */}
      <section className={styles.results} data-ecommerce-results>
        <nav className={styles.modeBar} data-ecommerce-modes>
          {categoryModes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                item.id === mode.id
                  ? `${styles.modeButton} ${styles.modeButtonOn}`
                  : styles.modeButton
              }
              data-ecommerce-mode={item.id}
              {...(STUDIO_MODES.find(
                (candidate) =>
                  candidate.category === item.category && candidate.usage === item.usage,
              )?.id === item.id
                ? { 'data-ecommerce-usage': item.usage }
                : {})}
              aria-pressed={item.id === mode.id}
              aria-checked={item.usage === usage}
              onClick={() => activateMode(item)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {workbench ?? (visibleResults.length === 0 ? (
          <div className={styles.caseSection} data-ecommerce-empty>
            <div className={styles.carousel} data-ecommerce-case-carousel>
              {carouselCases.map((item, index) => (
                <article className={styles.caseCard} key={item.id}>
                  <header className={styles.caseHead}>
                    <span className={styles.caseTitle}>{item.title}</span>
                    <span className={styles.caseTag}>{item.tag}</span>
                  </header>
                  <div className={styles.caseBody}>
                    <div className={styles.caseSource}>
                      {index === 0 && products[0]?.preview ? (
                        products[0].preview
                      ) : (
                        <span>{mode.mediaKind === 'video' ? '视频' : '商品'}</span>
                      )}
                    </div>
                    <span className={styles.caseArrow}>→</span>
                    <div className={styles.caseResults}>
                      {item.tiles.map((tile) => (
                        <span key={tile}>{tile}</span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.grid} data-ecommerce-grid>
            {visibleResults.map((r) => (
              <figure
                key={r.nodeId}
                className={styles.cell}
                data-ecommerce-result
                data-ecommerce-result-id={r.nodeId}
                data-status={r.status}
              >
                <div className={styles.cellBody}>
                  {r.preview ?? (
                    r.status === 'done' ? (
                      <span className={styles.cellState}>已完成</span>
                    ) : null
                  )}
                  {r.status === 'running' || r.status === 'failed' ? (
                    <ResultStatusOverlay item={r} />
                  ) : null}
                </div>
                {r.status === 'failed' ? (
                  <figcaption className={styles.cellFoot}>
                    <span className={styles.cellError}>
                      {r.error ?? '失败（没有原因记录）'}
                    </span>
                    {r.recovery === 'retry-save' && r.onRetrySave ? (
                      <button
                        type="button"
                        className={styles.cellRetry}
                        data-ecommerce-retry-save={r.nodeId}
                        disabled={running}
                        onClick={() => void r.onRetrySave?.()}
                      >
                        重试保存
                      </button>
                    ) : r.onRerun ? (
                      <button
                        type="button"
                        className={styles.cellRetry}
                        data-ecommerce-retry-result={r.nodeId}
                        disabled={running}
                        onClick={() => void r.onRerun?.()}
                      >
                        重新生成
                      </button>
                    ) : null}
                    {r.onRemoveFailed ? (
                      <button
                        type="button"
                        className={styles.cellRemove}
                        data-ecommerce-remove-failed={r.nodeId}
                        onClick={r.onRemoveFailed}
                      >
                        移除
                      </button>
                    ) : null}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ))}
        {longImageNode}
      </section>

      {detailTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-result-detail-title"
          data-ecommerce-result-detail-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-result-detail-title">
              结果详情
            </h2>
            <dl className={styles.detailGrid}>
              {detailTarget.model ? (
                <>
                  <dt>模型</dt>
                  <dd>{detailTarget.model}</dd>
                </>
              ) : null}
              {detailTarget.shotTitle ? (
                <>
                  <dt>图片类型</dt>
                  <dd>{detailTarget.shotTitle}</dd>
                </>
              ) : null}
              {detailTarget.ratio ? (
                <>
                  <dt>比例</dt>
                  <dd>{ecommerceRatioLabel(detailTarget.ratio)}</dd>
                </>
              ) : null}
              {detailTarget.headline ? (
                <>
                  <dt>画面主文案</dt>
                  <dd>{detailTarget.headline}</dd>
                </>
              ) : null}
              {detailTarget.visualSystem ? (
                <>
                  <dt>视觉系统</dt>
                  <dd>{detailTarget.visualSystem}</dd>
                </>
              ) : null}
              {detailTarget.createdAt ? (
                <>
                  <dt>生成时间</dt>
                  <dd>{new Date(detailTarget.createdAt).toLocaleString('zh-CN')}</dd>
                </>
              ) : null}
              {detailTarget.note ? (
                <>
                  <dt>任务要求</dt>
                  <dd>{detailTarget.note}</dd>
                </>
              ) : null}
            </dl>
            {detailTarget.prompt ? (
              <pre className={styles.detailPrompt} data-ecommerce-result-prompt>
                {detailTarget.prompt}
              </pre>
            ) : null}
            <div className={styles.confirmActions}>
              {detailTarget.prompt ? (
                <button
                  type="button"
                  className={styles.cancel}
                  data-ecommerce-result-prompt-copy
                  onClick={() => {
                    void navigator.clipboard?.writeText(detailTarget.prompt ?? '')
                  }}
                >
                  复制提示词
                </button>
              ) : null}
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-result-detail-close
                onClick={() => setDetailTarget(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {compareTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-compare-title"
          data-ecommerce-compare-dialog
        >
          <div className={`${styles.confirmCard} ${styles.compareCard}`}>
            <h2 className={styles.confirmTitle} id="ecommerce-compare-title">
              编辑前后对比
            </h2>
            <div className={styles.compareGrid}>
              <figure className={styles.comparePane}>
                <figcaption>原图</figcaption>
                <div className={styles.compareImage} data-ecommerce-compare-source-image>
                  {compareTarget.sourcePreview}
                </div>
              </figure>
              <figure className={styles.comparePane}>
                <figcaption>编辑结果</figcaption>
                <div className={styles.compareImage} data-ecommerce-compare-result-image>
                  {compareTarget.preview}
                </div>
              </figure>
            </div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-compare-close
                onClick={() => setCompareTarget(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {batchEditOpen ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-batch-edit-title"
          data-ecommerce-batch-edit-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-batch-edit-title">
              批量 AI 编辑
            </h2>
            <p className={styles.confirmText}>
              将对选中的 {selectedImageEditCount} 张图逐张执行同一套修改要求。每张都会生成独立新批次，
              原结果全部保留；会调用你的渠道，产生 {selectedImageEditCount} 次真实用量。
            </p>
            <div className={styles.editPresets} aria-label="常用批量编辑要求">
              {editPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.editPreset}
                  data-ecommerce-batch-edit-preset={preset.key}
                  onClick={() => {
                    setBatchInstruction(preset.instruction)
                    if (batchEditError) setBatchEditError('')
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.editReferenceRow}>
              <input
                id="ecommerce-batch-edit-reference"
                type="file"
                accept="image/*"
                hidden
                data-ecommerce-batch-edit-reference-input
                disabled={batchReferenceBusy}
                onChange={(e) => {
                  void pickEditReference(e.target.files?.[0], true)
                  e.currentTarget.value = ''
                }}
              />
              <label className={styles.editPreset} htmlFor="ecommerce-batch-edit-reference">
                {batchReferenceBusy
                  ? '正在读取参考图…'
                  : batchReference
                    ? '更换参考图'
                    : '上传参考图（可选）'}
              </label>
              {batchReference ? (
                <span className={styles.editReferencePreview} data-ecommerce-batch-edit-reference-preview>
                  {batchReference.preview}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-batch-edit-reference-remove
                    onClick={() => setBatchReference(null)}
                  >
                    移除
                  </button>
                </span>
              ) : null}
            </div>
            {editModels.length > 0 ? (
              <div className={styles.editModel}>
                <span>编辑模型</span>
                <EcommerceSelect
                  ariaLabel="批量编辑模型"
                  name="batch-edit-model"
                  value={batchEditModel}
                  onChange={setBatchEditModel}
                  menuMinWidth={250}
                  options={[
                    { value: '', label: '跟随原任务模型' },
                    ...editModels.map((item) => ({
                      value: item,
                      label: item,
                      icon: modelIconFor(item),
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-batch-edit-model': true }}
                />
              </div>
            ) : null}
            <textarea
              className={styles.editInput}
              data-ecommerce-batch-edit-instruction
              value={batchInstruction}
              maxLength={ECOMMERCE_NOTE_MAX}
              onChange={(e) => {
                setBatchInstruction(e.target.value)
                if (batchEditError) setBatchEditError('')
              }}
              placeholder="例如：只把每一张的背景都换成浅灰摄影棚背景，产品和文字保持不变"
              aria-label="这批图统一要改什么"
            />
            {batchEditError ? (
              <p className={styles.editError} data-ecommerce-batch-edit-error>
                {batchEditError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-batch-edit-cancel
                disabled={batchEditSubmitting}
                onClick={() => {
                  setBatchEditOpen(false)
                  setBatchInstruction('')
                  setBatchEditModel('')
                  setBatchReference(null)
                  setBatchEditError('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.generate} ${styles.editSubmit}`}
                data-ecommerce-batch-edit-submit
                disabled={
                  batchEditSubmitting ||
                  running ||
                  selectedImageEditCount === 0 ||
                  !batchInstruction.trim()
                }
                onClick={() => void submitBatchEdit()}
              >
                {batchEditSubmitting ? '正在逐张执行…' : `生成 ${selectedImageEditCount} 张编辑结果`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 单张结果定向编辑：独立批次、独立指令，不覆盖原结果 */}
      {editTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-edit-title"
          data-ecommerce-edit-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-edit-title">
              AI 编辑这一张
            </h2>
            <p className={styles.confirmText}>
              {editTarget.label}。只改你写明的内容，未点名的产品、人物、构图、光影和文字保持不变；
              原图与历史都不会被覆盖。
            </p>
            <div className={styles.editPresets} aria-label="常用编辑要求">
              {editPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.editPreset}
                  data-ecommerce-edit-preset={preset.key}
                  onClick={() => {
                    setEditInstruction(preset.instruction)
                    if (editError) setEditError('')
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.editReferenceRow}>
              <input
                id="ecommerce-edit-reference"
                type="file"
                accept="image/*"
                hidden
                data-ecommerce-edit-reference-input
                disabled={editReferenceBusy}
                onChange={(e) => {
                  void pickEditReference(e.target.files?.[0], false)
                  e.currentTarget.value = ''
                }}
              />
              <label className={styles.editPreset} htmlFor="ecommerce-edit-reference">
                {editReferenceBusy ? '正在读取参考图…' : editReference ? '更换参考图' : '上传参考图（可选）'}
              </label>
              {editReference ? (
                <span className={styles.editReferencePreview} data-ecommerce-edit-reference-preview>
                  {editReference.preview}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-edit-reference-remove
                    onClick={() => setEditReference(null)}
                  >
                    移除
                  </button>
                </span>
              ) : null}
            </div>
            {editModels.length > 0 ? (
              <div className={styles.editModel}>
                <span>编辑模型</span>
                <EcommerceSelect
                  ariaLabel="单张编辑模型"
                  name="edit-model"
                  value={editModel}
                  onChange={setEditModel}
                  menuMinWidth={250}
                  options={[
                    { value: '', label: '跟随原任务模型' },
                    ...editModels.map((item) => ({
                      value: item,
                      label: item,
                      icon: modelIconFor(item),
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-edit-model': true }}
                />
              </div>
            ) : null}
            <textarea
              className={styles.editInput}
              data-ecommerce-edit-instruction
              value={editInstruction}
              maxLength={ECOMMERCE_NOTE_MAX}
              onChange={(e) => {
                setEditInstruction(e.target.value)
                if (editError) setEditError('')
              }}
              placeholder="例如：只把背景换成海边日落，产品和画面文字保持不变"
              aria-label="这一张要改什么"
            />
            {editError ? (
              <p className={styles.editError} data-ecommerce-edit-error>
                {editError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-edit-cancel
                disabled={editSubmitting}
                onClick={() => {
                  setEditTarget(null)
                  setEditInstruction('')
                  setEditModel('')
                  setEditReference(null)
                  setEditError('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.generate} ${styles.editSubmit}`}
                data-ecommerce-edit-submit
                disabled={editSubmitting || running || !editInstruction.trim()}
                onClick={() => void submitEdit()}
              >
                {editSubmitting ? '提交中…' : '生成编辑结果'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {upscaleTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-upscale-title"
          data-ecommerce-upscale-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-upscale-title">
              AI 超清
            </h2>
            <p className={styles.confirmText}>
              使用真实 Topaz 超分模型放大
              {upscaleTarget.items.length > 1
                ? `所选 ${upscaleTarget.items.length} 张结果`
                : '这张结果'}
              ，不重绘商品也不生成新画面。原图和原任务都会保留；会调用当前渠道，产生
              {upscaleTarget.items.length > 1
                ? ` ${upscaleTarget.items.length} 次真实用量。`
                : '一次真实用量。'}
            </p>
            <p className={styles.hint} data-ecommerce-upscale-count>
              本次处理 {upscaleTarget.items.length} 张
            </p>
            <div className={styles.upscaleSection}>
              <span className={styles.upscaleLabel}>方案</span>
              <div className={styles.editPresets} aria-label="AI 超清方案">
                {availableUpscaleOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={
                      option.id === upscaleProfile
                        ? `${styles.editPreset} ${styles.editPresetOn}`
                        : styles.editPreset
                    }
                    data-ecommerce-upscale-profile={option.id}
                    title={option.hint}
                    onClick={() => setUpscaleProfile(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.upscaleSection}>
              <span className={styles.upscaleLabel}>放大倍数</span>
              <div className={styles.editPresets} aria-label="AI 超清倍数">
                {ECOMMERCE_UPSCALE_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    className={
                      scale === upscaleScale
                        ? `${styles.editPreset} ${styles.editPresetOn}`
                        : styles.editPreset
                    }
                    data-ecommerce-upscale-scale={scale}
                    onClick={() => setUpscaleScale(scale)}
                  >
                    {scale}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.hint} data-ecommerce-upscale-model>
              {
                availableUpscaleOptions.find((option) => option.id === upscaleProfile)?.model
              }
            </p>
            {upscaleError ? (
              <p className={styles.editError} data-ecommerce-upscale-error>
                {upscaleError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-upscale-cancel
                disabled={upscaleSubmitting}
                onClick={() => {
                  setUpscaleTarget(null)
                  setUpscaleError('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.generate}
                data-ecommerce-upscale-submit
                disabled={upscaleSubmitting || running}
                onClick={() => void submitUpscale()}
              >
                {upscaleSubmitting
                  ? `提交中…（${upscaleTarget.items.length} 张）`
                  : `AI 超清 ${upscaleScale}${upscaleTarget.items.length > 1 ? `（${upscaleTarget.items.length}）` : ''}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadPreview && uploadPreviewItem ? (
        <div
          className={styles.uploadLightbox}
          role="dialog"
          aria-modal="true"
          data-ecommerce-upload-lightbox
          onClick={() => setUploadPreview(null)}
        >
          <div className={styles.uploadLightboxBody} onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={styles.uploadLightboxClose}
              aria-label="关闭预览"
              onClick={() => setUploadPreview(null)}
            >
              ×
            </button>
            <button
              type="button"
              className={`${styles.uploadLightboxArrow} ${styles.uploadLightboxPrev}`}
              aria-label="上一张"
              disabled={uploadPreview.index <= 0}
              onClick={() =>
                setUploadPreview((current) =>
                  current && current.index > 0 ? { ...current, index: current.index - 1 } : current,
                )
              }
            >
              ‹
            </button>
            <div className={styles.uploadLightboxStage}>{uploadPreviewItem.preview}</div>
            <button
              type="button"
              className={`${styles.uploadLightboxArrow} ${styles.uploadLightboxNext}`}
              aria-label="下一张"
              disabled={uploadPreview.index >= uploadPreviewItems.length - 1}
              onClick={() =>
                setUploadPreview((current) =>
                  current && current.index < uploadPreviewItems.length - 1
                    ? { ...current, index: current.index + 1 }
                    : current,
                )
              }
            >
              ›
            </button>
            <span className={styles.uploadLightboxCount} data-ecommerce-upload-position>
              {uploadPreview.index + 1} / {uploadPreviewItems.length}
            </span>
          </div>
        </div>
      ) : null}

      {/* 付费确认（D6）：先报"预计 N 张"，确认后才发请求 */}
      {confirming ? (
        <div className={styles.confirm} role="dialog" aria-modal="true" data-ecommerce-confirm>
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle}>确认生成</h2>
            <p className={styles.confirmText}>
              将生成 <b>{mode.mediaKind === 'video' ? 1 : batchOutputCount}</b>{' '}
              {mode.mediaKind === 'video' ? '条' : '张'}
              {mode.mediaKind === 'video' ? mode.label : usageLabel(usage)}，比例{' '}
              {ecommerceRatioLabel(ratio)}
              {platform ? `，面向 ${platform.name}` : ''}。会调用你的渠道，产生真实用量。
            </p>
            {confirmUsesAiPlan ? (
              <p className={styles.confirmFlow} data-ecommerce-confirm-ai-flow>
                确认后会先生成整批方案，再由 AI 自审并修正逐张提示词，然后交给生图模型。
                本次会多花一次对话额度。
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-confirm-cancel
                onClick={() => setConfirming(false)}
              >
                再改改
              </button>
              <button
                type="button"
                className={styles.generate}
                data-ecommerce-confirm-ok
                onClick={() => void confirm()}
              >
                确认生成 {mode.mediaKind === 'video' ? 1 : batchOutputCount}{' '}
                {mode.mediaKind === 'video' ? '条视频' : '张'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
