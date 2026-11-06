import { defaultEcommerceModeOptions } from '../../../../domain/ecommerce/modeOptions'
import { ECOMMERCE_NOTE_MAX } from '../../../../domain/ecommerce/prompt'
import type { EcommerceModeOptions, EcommerceRequest } from '../../../../domain/ecommerce/types'
import type {
  EcommerceUpscaleProfile,
  EcommerceUpscaleScale,
} from '../../../../domain/ecommerce/upscale'
import {
  DEFAULT_MODE_FORM_STATE,
  STUDIO_MODES,
  type EcommerceResultItem,
  type EcommerceUpload,
  type StudioCategory,
  type StudioMode,
} from '../studioContracts'
import { ensureStudioModeState } from './studioFormProjection'
import {
  appendProductUpload,
  appendReferenceUpload,
  sellingPointFailureMessage,
  submitStudioGeneration,
  uploadFailureMessage,
  uploadRoom,
} from './studioRequestCoordinator'
import {
  runStudioUpscale,
  studioBatchEditFailureMessage,
  studioBatchEditSubmission,
  studioEditFailureMessage,
  studioEditSubmission,
  studioUploadFailureMessage,
} from './studioResultActionCoordinator'

export type StudioUploadKind = 'product' | 'reference'

export interface StudioActionResultTarget {
  nodeId: string
  label: string
}

export interface StudioUpscaleTarget {
  items: readonly EcommerceResultItem[]
  batch: boolean
}

export interface StudioActionState {
  request: EcommerceRequest
  mode: StudioMode
  products: readonly EcommerceUpload[]
  references: readonly EcommerceUpload[]
  note: string
  batchWhite: boolean
  productLimit: number
  running: boolean
  firstUpscaleProfile: EcommerceUpscaleProfile | null
  resultLabel: string
  uploadReadFailure: string
  emptySellingPointsError: string
  editTarget: StudioActionResultTarget | null
  editInstruction: string
  editReference: EcommerceUpload | null
  editModel: string
  batchInstruction: string
  results: readonly EcommerceResultItem[]
  selectedEditNodes: ReadonlySet<string>
  batchReference: EcommerceUpload | null
  batchEditModel: string
  upscaleTarget: StudioUpscaleTarget | null
  upscaleProfile: EcommerceUpscaleProfile
  upscaleScale: EcommerceUpscaleScale
}

export interface StudioActionPorts {
  onUpload(file: File, kind: StudioUploadKind): Promise<EcommerceUpload | null>
  onWriteSellingPoints?: (request: EcommerceRequest) => Promise<string>
  onGenerate: (request: EcommerceRequest) => Promise<void>
  onEditResult?: (
    nodeId: string,
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => Promise<void>
  onEditResults?: (
    nodeIds: readonly string[],
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => Promise<void>
  onUpscaleResult?: (
    nodeId: string,
    profile: EcommerceUpscaleProfile,
    scale: EcommerceUpscaleScale,
  ) => Promise<void>
  onModelChange(model: string): void
  setModeId(value: string): void
  setCategory(value: StudioCategory): void
  setUsage(value: StudioMode['usage']): void
  setModeOptionsByMode(
    update: (current: Record<string, EcommerceModeOptions>) => Record<string, EcommerceModeOptions>,
  ): void
  setModeStates(
    update: (
      current: Record<string, ReturnType<typeof DEFAULT_MODE_FORM_STATE>>,
    ) => Record<string, ReturnType<typeof DEFAULT_MODE_FORM_STATE>>,
  ): void
  setError(value: string): void
  setProducts(
    update: (current: EcommerceUpload[]) => EcommerceUpload[],
  ): void
  setReferences(
    update: (current: EcommerceUpload[]) => EcommerceUpload[],
  ): void
  setDragOver(value: StudioUploadKind | null): void
  setWritingSellingPoints(value: boolean): void
  setSellingPointsError(value: string): void
  setNote(value: string): void
  setEditTarget(value: StudioActionResultTarget | null): void
  setEditInstruction(value: string): void
  setEditModel(value: string): void
  setEditReference(value: EcommerceUpload | null): void
  setEditError(value: string): void
  setEditSubmitting(value: boolean): void
  setEditReferenceBusy(value: boolean): void
  setBatchEditOpen(value: boolean): void
  setBatchInstruction(value: string): void
  setBatchEditError(value: string): void
  setBatchEditSubmitting(value: boolean): void
  setBatchEditModel(value: string): void
  setBatchReference(value: EcommerceUpload | null): void
  setBatchReferenceBusy(value: boolean): void
  setSelectedEditNodes(value: Set<string>): void
  setUpscaleTarget(value: StudioUpscaleTarget | null): void
  setUpscaleProfile(value: EcommerceUpscaleProfile): void
  setUpscaleScale(value: EcommerceUpscaleScale): void
  setUpscaleSubmitting(value: boolean): void
  setUpscaleError(value: string): void
  setConfirming(value: boolean): void
}

export function createStudioActions(state: StudioActionState, ports: StudioActionPorts) {
  const pickUpload = async (file: File | undefined, kind: StudioUploadKind) => {
    if (!file) return
    ports.setError('')
    const uploaded = await ports.onUpload(file, kind)
    if (!uploaded) {
      ports.setError(state.uploadReadFailure)
      return
    }
    if (kind === 'product') {
      ports.setProducts((current) => appendProductUpload(current, uploaded, {
        batchWhite: state.batchWhite,
        productLimit: state.productLimit,
        productCount: current.length,
        referenceCount: state.references.length,
      }))
      return
    }
    ports.setReferences((current) =>
      appendReferenceUpload(current, uploaded, state.products.length),
    )
  }

  const activateMode = (next: StudioMode) => {
    const previousKind = state.mode.mediaKind
    ports.setModeId(next.id)
    ports.setCategory(next.category)
    ports.setUsage(next.usage)
    ports.setModeOptionsByMode((current) =>
      ensureStudioModeState(current, next, defaultEcommerceModeOptions(next.id)),
    )
    ports.setModeStates((current) =>
      ensureStudioModeState(current, next, DEFAULT_MODE_FORM_STATE(next)),
    )
    if (previousKind !== next.mediaKind) ports.onModelChange('')
    ports.setError('')
  }

  return {
    openEditForResult: (result: EcommerceResultItem) => {
      if (!ports.onEditResult || state.running || result.mime?.startsWith('video/')) return
      ports.setEditTarget({ nodeId: result.nodeId, label: state.resultLabel })
      ports.setEditInstruction(state.note.trim())
      ports.setEditModel('')
      ports.setEditReference(null)
      ports.setEditError('')
    },
    openUpscaleForResult: (result: EcommerceResultItem) => {
      if (!ports.onUpscaleResult || state.running || !state.firstUpscaleProfile) return
      if (result.mime?.startsWith('video/')) return
      ports.setUpscaleTarget({ items: [result], batch: false })
      ports.setUpscaleProfile(state.firstUpscaleProfile)
      ports.setUpscaleScale('4x')
      ports.setUpscaleError('')
    },
    activateMode,
    activateCategory: (next: StudioCategory) => {
      const first = STUDIO_MODES.find((item) => item.category === next)
      if (first) activateMode(first)
    },
    onPick: pickUpload,
    /**
     * **拖进来的文件**（对账 #427）。
     *
     * 两条与文件选择保持一致的规矩（两条路各写一套迟早分叉）：
     * - 走的是**同一个** `onPick`（所以"不是图 / 读不出来"的提示也是同一句话）；
     * - 参考图仍然**最多 4 张**：放不下的一次**不收**，也不偷偷挤掉已有的。
     */
    onDropFiles: (kind: StudioUploadKind, files: FileList | null) => {
      ports.setDragOver(null)
      const picked = [...(files ?? [])]
      if (picked.length === 0) return
      void (async () => {
        const room = uploadRoom(kind, {
          batchWhite: state.batchWhite,
          productLimit: state.productLimit,
          productCount: state.products.length,
          referenceCount: state.references.length,
        })
        for (const file of picked.slice(0, room)) await pickUpload(file, kind)
      })()
    },
    pickEditReference: async (file: File | undefined, batch: boolean) => {
      if (!file) return
      if (batch) {
        ports.setBatchReferenceBusy(true)
        ports.setBatchEditError('')
      } else {
        ports.setEditReferenceBusy(true)
        ports.setEditError('')
      }
      try {
        const uploaded = await ports.onUpload(file, 'reference')
        if (!uploaded) {
          const message = studioUploadFailureMessage()
          if (batch) ports.setBatchEditError(message)
          else ports.setEditError(message)
          return
        }
        if (batch) ports.setBatchReference(uploaded)
        else ports.setEditReference(uploaded)
      } finally {
        if (batch) ports.setBatchReferenceBusy(false)
        else ports.setEditReferenceBusy(false)
      }
    },
    writeSellingPoints: async () => {
      if (!ports.onWriteSellingPoints) return
      ports.setWritingSellingPoints(true)
      ports.setSellingPointsError('')
      try {
        const text = (await ports.onWriteSellingPoints(state.request)).trim()
        if (!text) {
          ports.setSellingPointsError(state.emptySellingPointsError)
          return
        }
        ports.setNote(text.slice(0, ECOMMERCE_NOTE_MAX))
      } catch (error) {
        ports.setSellingPointsError(sellingPointFailureMessage(error))
      } finally {
        ports.setWritingSellingPoints(false)
      }
    },
    confirm: async () => {
      ports.setConfirming(false)
      ports.setError('')
      try {
        await submitStudioGeneration({
          batchWhite: state.batchWhite,
          products: state.products,
          request: state.request,
          onGenerate: ports.onGenerate,
        })
      } catch (error) {
        ports.setError(uploadFailureMessage(error))
      }
    },
    submitEdit: async () => {
      if (!state.editTarget || !ports.onEditResult) return
      const submission = studioEditSubmission(
        state.editInstruction,
        state.editReference,
        state.editModel,
      )
      if ('error' in submission) {
        ports.setEditError(submission.error)
        return
      }
      ports.setEditError('')
      ports.setEditSubmitting(true)
      try {
        await ports.onEditResult(
          state.editTarget.nodeId,
          submission.instruction,
          submission.options,
        )
        ports.setEditTarget(null)
        ports.setEditInstruction('')
        ports.setEditReference(null)
        ports.setEditModel('')
      } catch (error) {
        ports.setEditError(studioEditFailureMessage(error))
      } finally {
        ports.setEditSubmitting(false)
      }
    },
    submitUpscale: async () => {
      if (!state.upscaleTarget?.items.length || !ports.onUpscaleResult) return
      ports.setUpscaleError('')
      ports.setUpscaleSubmitting(true)
      try {
        const progress = await runStudioUpscale({
          items: state.upscaleTarget.items,
          profile: state.upscaleProfile,
          scale: state.upscaleScale,
          onUpscale: ports.onUpscaleResult,
        })
        if (progress.error) {
          ports.setUpscaleError(progress.error)
          return
        }
        if (state.upscaleTarget.batch) ports.setSelectedEditNodes(new Set())
        ports.setUpscaleTarget(null)
      } finally {
        ports.setUpscaleSubmitting(false)
      }
    },
    submitBatchEdit: async () => {
      if (!ports.onEditResults) return
      const submission = studioBatchEditSubmission({
        instruction: state.batchInstruction,
        results: state.results,
        selectedNodeIds: state.selectedEditNodes,
        reference: state.batchReference,
        model: state.batchEditModel,
      })
      if ('error' in submission) {
        ports.setBatchEditError(submission.error)
        return
      }
      ports.setBatchEditError('')
      ports.setBatchEditSubmitting(true)
      try {
        await ports.onEditResults(
          submission.imageNodeIds,
          submission.instruction,
          submission.options,
        )
        ports.setBatchEditOpen(false)
        ports.setBatchInstruction('')
        ports.setBatchReference(null)
        ports.setBatchEditModel('')
        ports.setSelectedEditNodes(new Set())
      } catch (error) {
        ports.setBatchEditError(studioBatchEditFailureMessage(error))
      } finally {
        ports.setBatchEditSubmitting(false)
      }
    },
  }
}
