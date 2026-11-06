import {
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
import { ECOMMERCE_PLATFORMS } from '../../domain/ecommerce/platforms'
import {
  ecommerceLanguageOptionLabel,
  type EcommerceLanguage,
  type EcommerceModeOptions,
  type EcommerceRequest,
  type EcommerceUsage,
} from '../../domain/ecommerce/types'
import type {
  EcommerceUpscaleProfile,
  EcommerceUpscaleScale,
} from '../../domain/ecommerce/upscale'
import { normalizeEcommerceModeOptions } from '../../domain/ecommerce/modeOptions'
import type { EcommerceModeFormState } from '../../domain/ecommerce/draft'
import { styles } from './studio/studioStyles'
import {
  type StudioCategory,
  type EcommerceResultItem,
  type EcommerceUpload,
  type EcommerceStudioProps,
} from './studio/studioContracts'
import { GenerationStageView } from './studio/EcommerceStudioStatusViews'
import { EcommerceStudioCategoryRail } from './studio/EcommerceStudioCategoryRail'
import { EcommerceStudioUploadPanels } from './studio/EcommerceStudioUploadPanels'
import { EcommerceStudioCommonParameters } from './studio/EcommerceStudioCommonParameters'
import { EcommerceStudioSellingPointsPanel } from './studio/EcommerceStudioSellingPointsPanel'
import { EcommerceStudioModelFields } from './studio/EcommerceStudioModelFields'
import { EcommerceStudioResultsPane } from './studio/EcommerceStudioResultsPane'
import { EcommerceStudioResultDetailDialogs } from './studio/EcommerceStudioResultDetailDialogs'
import { EcommerceStudioEditDialogs } from './studio/EcommerceStudioEditDialogs'
import { EcommerceStudioUpscaleDialog } from './studio/EcommerceStudioUpscaleDialog'
import { EcommerceStudioUploadPreviewDialog } from './studio/EcommerceStudioUploadPreviewDialog'
import { EcommerceStudioGenerateConfirmDialog } from './studio/EcommerceStudioGenerateConfirmDialog'
import {
  applyModeFormPatch,
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
import { createStudioActions } from './studio/controller/studioActionCoordinator'
import {
  buildStudioRequest,
  usesAiPlan,
  validateStudioStart,
} from './studio/controller/studioRequestCoordinator'
import {
  availableStudioUpscaleOptions,
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
export { GenerationStageView }
export { ResultStatusOverlay } from './studio/EcommerceStudioStatusViews'

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

  const studioActions = createStudioActions({
    request: buildRequest(),
    mode,
    products,
    references,
    note,
    batchWhite,
    productLimit,
    running,
    firstUpscaleProfile: availableUpscaleOptions[0]?.id ?? null,
    resultLabel: '这张结果',
    uploadReadFailure: '这张图没能读进来（格式不支持或读取失败），换一张再试',
    emptySellingPointsError: '模型没有返回可用的卖点文案',
    editTarget,
    editInstruction,
    editReference,
    editModel,
    batchInstruction,
    results,
    selectedEditNodes,
    batchReference,
    batchEditModel,
    upscaleTarget,
    upscaleProfile,
    upscaleScale,
  }, {
    onUpload,
    ...(onWriteSellingPoints ? { onWriteSellingPoints } : {}),
    onGenerate,
    ...(onEditResult ? { onEditResult } : {}),
    ...(onEditResults ? { onEditResults } : {}),
    ...(onUpscaleResult ? { onUpscaleResult } : {}),
    onModelChange,
    setModeId,
    setCategory,
    setUsage,
    setModeOptionsByMode,
    setModeStates,
    setError,
    setProducts,
    setReferences,
    setDragOver,
    setWritingSellingPoints,
    setSellingPointsError,
    setNote,
    setEditTarget,
    setEditInstruction,
    setEditModel,
    setEditReference,
    setEditError,
    setEditSubmitting,
    setEditReferenceBusy,
    setBatchEditOpen,
    setBatchInstruction,
    setBatchEditError,
    setBatchEditSubmitting,
    setBatchEditModel,
    setBatchReference,
    setBatchReferenceBusy,
    setSelectedEditNodes,
    setUpscaleTarget,
    setUpscaleProfile,
    setUpscaleScale,
    setUpscaleSubmitting,
    setUpscaleError,
    setConfirming,
  })
  const {
    openEditForResult,
    openUpscaleForResult,
    activateMode,
    activateCategory,
    onPick,
    onDropFiles,
    pickEditReference,
    writeSellingPoints,
    confirm,
    submitEdit,
    submitUpscale,
    submitBatchEdit,
  } = studioActions

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
  const changeBatchInstruction = (value: string) => {
    setBatchInstruction(value)
    if (batchEditError) setBatchEditError('')
  }
  const applyBatchPreset = (instruction: string) => {
    setBatchInstruction(instruction)
    if (batchEditError) setBatchEditError('')
  }
  const closeBatchEdit = () => {
    setBatchEditOpen(false)
    setBatchInstruction('')
    setBatchEditModel('')
    setBatchReference(null)
    setBatchEditError('')
  }
  const changeEditInstruction = (value: string) => {
    setEditInstruction(value)
    if (editError) setEditError('')
  }
  const applyEditPreset = (instruction: string) => {
    setEditInstruction(instruction)
    if (editError) setEditError('')
  }
  const closeEdit = () => {
    setEditTarget(null)
    setEditInstruction('')
    setEditModel('')
    setEditReference(null)
    setEditError('')
  }
  const closeUpscale = () => {
    setUpscaleTarget(null)
    setUpscaleError('')
  }
  const copyDetailPrompt = (prompt: string) => {
    void navigator.clipboard?.writeText(prompt)
  }
  const previousUploadPreview = () => {
    setUploadPreview((current) =>
      current && current.index > 0 ? { ...current, index: current.index - 1 } : current,
    )
  }
  const nextUploadPreview = () => {
    setUploadPreview((current) =>
      current && current.index < uploadPreviewItems.length - 1
        ? { ...current, index: current.index + 1 }
        : current,
    )
  }

  return (
    <div className={styles.wrap} data-ecommerce-studio>
      <EcommerceStudioCategoryRail
        category={category}
        onSelect={activateCategory}
      />

      {/* 右：参数 */}
      <aside className={styles.form} data-ecommerce-form>
        <div className={styles.formScroll} data-ecommerce-param-mode={mode.id}>
        <EcommerceStudioUploadPanels
          mode={mode}
          products={products}
          references={references}
          productLimit={productLimit}
          batchWhite={batchWhite}
          dragOver={dragOver}
          referenceRequired={referenceRequired}
          showReferenceBlock={showReferenceBlock}
          referenceLabel={referenceLabel}
          dropProps={dropProps}
          onPick={onPick}
          setProducts={setProducts}
          setReferences={setReferences}
          setUploadPreview={setUploadPreview}
        />

        <EcommerceStudioCommonParameters
          mode={mode}
          modeOptions={modeOptions}
          platformId={platformId}
          orderedPlatforms={orderedPlatforms}
          language={language}
          ratio={ratio}
          resolution={resolution}
          quality={quality}
          resolutionChoices={resolutionChoices}
          qualityChoices={qualityChoices}
          showCommonFields={showCommonFields}
          showPlatformAndLanguage={showPlatformAndLanguage}
          showLanguageField={showLanguageField}
          showRatioField={showRatioField}
          showResolutionField={showResolutionField}
          showQualityField={showQualityField}
          setModeOption={setModeOption}
          setPlatformId={setPlatformId}
          setLanguage={setLanguage}
          setRatio={setRatio}
          setResolution={setResolution}
          setQuality={setQuality}
        />

        <EcommerceStudioSellingPointsPanel
          visible={showSellingPoints}
          note={note}
          writingSellingPoints={writingSellingPoints}
          chatTargetLabel={chatTargetLabel}
          sellingPointsError={sellingPointsError}
          onWriteSellingPoints={writeSellingPoints}
          onNoteChange={setNote}
        />

        <EcommerceStudioModelFields
          mode={mode}
          modeOptions={modeOptions}
          chatModels={chatModels}
          intentModel={intentModel}
          chatTargetLabel={chatTargetLabel}
          onConfigureChannels={onConfigureChannels}
          onIntentModelChange={onIntentModelChange}
          model={model}
          onGenerateModelChange={handleGenerateModelChange}
          models={models}
          videoModels={videoModels}
          setModeOption={setModeOption}
          toggleModeOption={toggleModeOption}
        />

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
      <EcommerceStudioResultsPane
        mode={mode}
        usage={usage}
        categoryModes={categoryModes}
        products={products}
        workbench={workbench}
        visibleResults={visibleResults}
        carouselCases={carouselCases}
        longImageNode={longImageNode}
        running={running}
        onActivateMode={activateMode}
      />

      <EcommerceStudioResultDetailDialogs
        detailTarget={detailTarget}
        compareTarget={compareTarget}
        onCloseDetail={() => setDetailTarget(null)}
        onCopyPrompt={copyDetailPrompt}
        onCloseCompare={() => setCompareTarget(null)}
      />

      <EcommerceStudioEditDialogs
        batchEditOpen={batchEditOpen}
        selectedImageEditCount={selectedImageEditCount}
        editPresets={editPresets}
        batchInstruction={batchInstruction}
        batchEditError={batchEditError}
        batchReference={batchReference}
        batchReferenceBusy={batchReferenceBusy}
        editModels={editModels}
        batchEditModel={batchEditModel}
        batchEditSubmitting={batchEditSubmitting}
        running={running}
        editTarget={editTarget}
        editInstruction={editInstruction}
        editError={editError}
        editReference={editReference}
        editReferenceBusy={editReferenceBusy}
        editModel={editModel}
        editSubmitting={editSubmitting}
        onBatchInstructionChange={changeBatchInstruction}
        onBatchPreset={applyBatchPreset}
        onPickBatchReference={(file) => pickEditReference(file, true)}
        onRemoveBatchReference={() => setBatchReference(null)}
        onBatchModelChange={setBatchEditModel}
        onBatchCancel={closeBatchEdit}
        onBatchSubmit={submitBatchEdit}
        onEditInstructionChange={changeEditInstruction}
        onEditPreset={applyEditPreset}
        onPickEditReference={(file) => pickEditReference(file, false)}
        onRemoveEditReference={() => setEditReference(null)}
        onEditModelChange={setEditModel}
        onEditCancel={closeEdit}
        onEditSubmit={submitEdit}
      />

      <EcommerceStudioUpscaleDialog
        upscaleTarget={upscaleTarget}
        availableUpscaleOptions={availableUpscaleOptions}
        upscaleProfile={upscaleProfile}
        upscaleScale={upscaleScale}
        upscaleError={upscaleError}
        upscaleSubmitting={upscaleSubmitting}
        running={running}
        onProfileChange={setUpscaleProfile}
        onScaleChange={setUpscaleScale}
        onCancel={closeUpscale}
        onSubmit={submitUpscale}
      />

      <EcommerceStudioUploadPreviewDialog
        uploadPreviewItem={uploadPreviewItem}
        uploadPreviewIndex={uploadPreview?.index ?? 0}
        uploadPreviewCount={uploadPreviewItems.length}
        onClose={() => setUploadPreview(null)}
        onPrevious={previousUploadPreview}
        onNext={nextUploadPreview}
      />

      {/* 付费确认（D6）：先报"预计 N 张"，确认后才发请求 */}
      <EcommerceStudioGenerateConfirmDialog
        confirming={confirming}
        mode={mode}
        batchOutputCount={batchOutputCount}
        usage={usage}
        ratio={ratio}
        platform={platform}
        confirmUsesAiPlan={confirmUsesAiPlan}
        onCancel={() => setConfirming(false)}
        onConfirm={confirm}
      />
    </div>
  )
}
