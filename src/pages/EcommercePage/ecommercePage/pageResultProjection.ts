import {
  resultDisplayStatus,
  resultMetadataOf,
  freshestResultsById,
  type EcommerceDisplayResultStatus,
  type EcommerceResultRecord,
  type EcommerceTaskRecord,
} from '../../../domain/ecommerce/tasks'
import type { EcommerceCanvasItem } from '../../../domain/ecommerce/canvasItem'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { EcommerceGenerationStage } from '../../../domain/ecommerce/progress'
import type { EcommerceResultItem } from '../../../workbenches/ecommerce/studio/studioContracts'
import type { LongImageTileSource } from '../LongImagePanel'
import type { EcommerceResultLiveState } from '../../../domain/ecommerce/tasks'
import type { LegacyGenerationNode } from '../ecommercePageSupport'
import { imageParamsFor } from '../../../domain/shared/modelParams/imageParams'

export interface EcommerceResultViewContext {
  activeTask: EcommerceTaskRecord | null
  resultRows: readonly EcommerceResultRecord[]
  nodeIds: readonly string[]
  nodes: readonly LegacyGenerationNode[]
  legacyAssetHashesOfNode(node: LegacyGenerationNode | undefined): string[]
  resultStateOf(resultId: string): { kind?: EcommerceResultLiveState; error?: unknown } | null | undefined
  previewOf(hash: string, mime?: string): EcommerceResultItem['preview']
  downloadOf(hash: string | undefined): EcommerceResultItem['onDownload']
  saveToLibraryOf(
    hash: string | undefined,
    meta: { width?: number; height?: number; prompt?: string; model?: string; ratio?: string },
  ): EcommerceResultItem['onSaveToLibrary']
  errorDescriptionOf(error: unknown): string
  runStoredResult(row: EcommerceResultRecord, options: { inPlace: boolean }): Promise<void>
  retryWorkbenchResult(resultId: string): Promise<void> | void
  retrySaveWorkbenchResult(resultId: string): Promise<void> | void
  removeFailedResult(taskId: string, resultId: string): Promise<void> | void
}

function naturalSizeOf(value: unknown): { width: number; height: number } | null {
  const size = value as { width?: unknown; height?: unknown } | undefined
  if (
    typeof size?.width !== 'number' || size.width <= 0 ||
    typeof size?.height !== 'number' || size.height <= 0
  ) return null
  return { width: size.width, height: size.height }
}

/** Project persisted rows into result cards without owning task rows, execution state or React state. */
export function projectEcommerceResults(context: EcommerceResultViewContext): EcommerceResultItem[] {
  const { activeTask } = context
  if (!activeTask) {
    return context.nodeIds.map((id) => {
      const node = context.nodes.find((candidate) => candidate.id === id)
      const data = node?.data as
        | { prompt?: unknown; model?: unknown; ratio?: unknown; assetMime?: unknown }
        | undefined
      const asset = context.legacyAssetHashesOfNode(node)
      const assetHash = asset[0]
      const pixelSize = naturalSizeOf(node?.data?.naturalSize)
      const mime = typeof data?.assetMime === 'string' ? data.assetMime : undefined
      const status = resultDisplayStatus({ stored: 'pending', hasAsset: !!assetHash })
      return {
        nodeId: id,
        status,
        imageHash: assetHash,
        ...(mime ? { mime } : {}),
        pixelSize,
        preview: assetHash ? context.previewOf(assetHash, mime) : undefined,
        onDownload: context.downloadOf(assetHash),
        onSaveToLibrary: context.saveToLibraryOf(assetHash, {
          ...(pixelSize ? { width: pixelSize.width, height: pixelSize.height } : {}),
          ...(typeof data?.prompt === 'string' && data.prompt ? { prompt: data.prompt } : {}),
          ...(typeof data?.model === 'string' && data.model ? { model: data.model } : {}),
          ...(typeof data?.ratio === 'string' && data.ratio ? { ratio: data.ratio } : {}),
        }),
        onRerun: undefined,
        onReplace: undefined,
      }
    })
  }
  return context.resultRows.map((row) => {
    const node = context.nodes.find((candidate) => candidate.id === row.nodeId)
    const hash = row.assetHash ?? context.legacyAssetHashesOfNode(node)[0]
    const natural = naturalSizeOf(node?.data?.naturalSize)
    const width = row.width ?? natural?.width
    const height = row.height ?? natural?.height
    const liveState = context.resultStateOf(row.id)
    const status = resultDisplayStatus({
      stored: row.status,
      ...(liveState?.kind ? { live: liveState.kind } : {}),
      hasAsset: !!hash,
    })
    const rerunnable = status !== 'running'
    const rerun = async (inPlace = false) => {
      await context.runStoredResult(row, { inPlace })
    }
    return {
      nodeId: row.nodeId,
      resultId: row.id,
      status,
      ...(row.recovery ? { recovery: row.recovery } : {}),
      imageHash: hash,
      ...(row.mime ? { mime: row.mime } : {}),
      pixelSize: width !== undefined && height !== undefined ? { width, height } : null,
      error:
        row.errorText ??
        (liveState?.kind === 'failed' ? context.errorDescriptionOf(liveState.error) : undefined) ??
        (row.status === 'canceled' ? '已取消（结果仍保留在库里）' : undefined),
      preview: hash ? context.previewOf(hash, row.mime) : undefined,
      sourcePreview: activeTask.sourceAssetHash
        ? context.previewOf(activeTask.sourceAssetHash)
        : undefined,
      ...(row.prompt ? { prompt: row.prompt } : {}),
      ...(row.model ?? activeTask.request.model
        ? { model: row.model ?? activeTask.request.model }
        : {}),
      ratio: row.ratio ?? activeTask.request.ratio,
      ...(row.shotTitle ? { shotTitle: row.shotTitle } : {}),
      ...(row.brief ? { brief: row.brief } : {}),
      ...(row.headline ? { headline: row.headline } : {}),
      ...(row.subheadline ? { subheadline: row.subheadline } : {}),
      ...(row.visualSystem ? { visualSystem: row.visualSystem } : {}),
      ...(activeTask.request.note ? { note: activeTask.request.note } : {}),
      createdAt: row.createdAt,
      onDownload: context.downloadOf(hash),
      onSaveToLibrary: context.saveToLibraryOf(hash, {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(row.prompt ? { prompt: row.prompt } : {}),
        ...(row.model ? { model: row.model } : {}),
        ...((row.ratio ?? activeTask.request.ratio)
          ? { ratio: row.ratio ?? activeTask.request.ratio }
          : {}),
      }),
      onRerun:
        row.recovery === 'retry-save'
          ? undefined
          : row.status === 'failed' || row.status === 'canceled'
            ? () => context.retryWorkbenchResult(row.id)
            : rerunnable
              ? () => rerun(false)
              : undefined,
      onRetrySave:
        row.recovery === 'retry-save'
          ? () => context.retrySaveWorkbenchResult(row.id)
          : undefined,
      onReplace: rerunnable ? () => rerun(true) : undefined,
      onRemoveFailed:
        row.status === 'failed'
          ? () => void context.removeFailedResult(activeTask.id, row.id)
          : undefined,
    }
  })
}

export function longImageTilesOf(
  results: readonly EcommerceResultItem[],
): LongImageTileSource[] {
  return results.flatMap((result) => {
    if (
      result.status !== 'done' ||
      !result.imageHash ||
      !result.pixelSize ||
      result.mime?.startsWith('video/')
    ) return []
    return [{
      id: result.nodeId,
      hash: result.imageHash,
      width: result.pixelSize.width,
      height: result.pixelSize.height,
    }]
  })
}

export function generationStageOfTerminalResults(
  current: EcommerceGenerationStage | null,
  results: readonly EcommerceResultItem[],
): EcommerceGenerationStage | null {
  if (results.length === 0) return current
  const terminal = results.filter((result) => result.status !== 'running').length
  if (terminal === 0) return current
  if (terminal >= results.length) {
    const label = `本批已结束 ${results.length}/${results.length}`
    return current?.phase === 'done' && current.label === label
      ? current
      : { phase: 'done', label, current: results.length, total: results.length }
  }
  if (current?.phase === 'done') return current
  const label = `正在生成 ${terminal}/${results.length}`
  return current?.phase === 'generate' && current.label === label
    ? current
    : { phase: 'generate', label, current: terminal, total: results.length }
}

export function retryableResultIdsOf(
  activeTask: EcommerceTaskRecord | null,
  resultRows: readonly EcommerceResultRecord[],
  results: readonly EcommerceResultItem[],
): string[] {
  return activeTask
    ? resultRows
        .filter((row) => row.status === 'failed' || row.status === 'canceled')
        .map((row) => row.id)
    : results
        .filter((result) => result.status === 'failed')
        .flatMap((result) => (result.resultId ? [result.resultId] : []))
}

export interface EcommerceStoredResultPorts {
  activeTask: EcommerceTaskRecord | null
  taskHistory: readonly EcommerceTaskRecord[]
  row: EcommerceResultRecord
  inPlace?: boolean
  now: number
  subjectId(): string
  taskRepo: {
    appendResults(
      taskId: string,
      nodeIds: string[],
      metadata: ReturnType<typeof resultMetadataOf>[],
    ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
    updateResult(row: EcommerceResultRecord): Promise<unknown>
  }
}

/** Prepare a rerun target: append a result row only for a new draw, then mark the target running. */
export async function prepareStoredResultRerun(
  ports: EcommerceStoredResultPorts,
): Promise<{ task: EcommerceTaskRecord; targetRow: EcommerceResultRecord; running: EcommerceResultRecord }> {
  const sourceTask =
    (ports.activeTask?.id === ports.row.taskId ? ports.activeTask : null) ??
    ports.taskHistory.find((task) => task.id === ports.row.taskId) ??
    null
  if (!sourceTask) throw new Error('找不到这张图所属的电商任务')
  let task = sourceTask
  let targetRow = ports.row
  if (!ports.inPlace) {
    const appended = await ports.taskRepo.appendResults(
      sourceTask.id,
      [ports.subjectId()],
      [resultMetadataOf(ports.row)],
    )
    task = appended.task
    targetRow = appended.results[appended.results.length - 1] ?? ports.row
  }
  const { errorText: _oldError, ...rest } = targetRow
  const running: EcommerceResultRecord = { ...rest, status: 'running', updatedAt: ports.now }
  await ports.taskRepo.updateResult(running)
  return { task, targetRow, running }
}

export interface EcommercePrescribedShot {
  prompt: string
  params: Record<string, unknown>
  metadata: ReturnType<typeof resultMetadataOf>
}

/** Prescribe one independent run per result before task creation, preserving each per-shot ratio and metadata. */
export function prescribeEcommerceShots(input: {
  count: number
  planPrompts: readonly string[]
  fallbackPrompt: string
  ratio: string
  shots: readonly {
    title?: string
    brief?: string
    ratio?: string
    headline?: string
    subheadline?: string
    visualSystem?: string
  }[]
  mediaKind: 'image' | 'video'
  request: Pick<EcommerceRequest, 'resolution' | 'quality' | 'scale' | 'durationSec'>
  model: string
  imagePromptForModel(args: {
    prompt: string
    model: string
    ratio: string
    headline?: string
    subheadline?: string
  }): string
  aspectRatioOf(ratio: string): string
}): EcommercePrescribedShot[] {
  const prescribed: EcommercePrescribedShot[] = []
  for (let index = 0; index < input.count; index += 1) {
    const shot = input.shots[index]
    const metadata = resultMetadataOf({
      shotTitle: shot?.title,
      brief: shot?.brief,
      ratio: shot?.ratio,
      headline: shot?.headline,
      subheadline: shot?.subheadline,
      visualSystem: shot?.visualSystem,
    })
    const prompt = input.imagePromptForModel({
      prompt: input.planPrompts[index] ?? input.fallbackPrompt,
      model: input.model,
      ratio: shot?.ratio ?? input.ratio,
      headline: shot?.headline,
      subheadline: shot?.subheadline,
    })
    const params: Record<string, unknown> = {
      mode: input.mediaKind,
      ratio: input.aspectRatioOf(shot?.ratio ?? input.ratio),
      count: 1,
      ...(input.request.resolution ? { resolution: input.request.resolution } : {}),
      ...(input.request.quality ? { quality: input.request.quality } : {}),
      ...(input.request.scale ? { scale: input.request.scale } : {}),
      ...(input.mediaKind === 'video' ? { durationSec: input.request.durationSec ?? 5 } : {}),
    }
    prescribed.push({ prompt, params, metadata })
  }
  return prescribed
}

/** Keep the page's existing model-parameter projection: spec sizes are exposed as resolutions. */
export function imageParamOptionsByModel(
  models: readonly string[],
): Readonly<Record<string, { resolutions: readonly string[]; qualities: readonly string[] }>> {
  return Object.fromEntries(models.map((name) => {
    const spec = imageParamsFor(name)
    return [name, {
      resolutions: spec?.sizes ?? ['1K', '2K', '4K'],
      qualities: spec?.qualities ?? [],
    }]
  }))
}

export interface EcommerceWorkbenchActionContext {
  item: EcommerceCanvasItem
  action: 'download' | 'save' | 'retry'
  workbenchResults: readonly EcommerceResultRecord[]
  resultRows: readonly EcommerceResultRecord[]
}

/** Resolve the newest result row and asset for a workbench action, including retry-save recovery. */
export function workbenchActionTargetOf(context: EcommerceWorkbenchActionContext): {
  row: EcommerceResultRecord | null
  hash: string | undefined
} {
  const row =
    (context.item.resultId
      ? workbenchResultById(context.workbenchResults, context.resultRows, context.item.resultId)
      : null) ?? null
  if (context.action === 'retry') return { row, hash: undefined }
  return { row, hash: context.item.assetHash ?? row?.assetHash }
}

function workbenchResultById(
  workbenchResults: readonly EcommerceResultRecord[],
  resultRows: readonly EcommerceResultRecord[],
  resultId: string,
): EcommerceResultRecord | null {
  const latest = freshestResultsById(workbenchResults, resultRows).get(resultId)
  if (latest) return latest
  return workbenchResults.find((result) => result.id === resultId) ??
    resultRows.find((result) => result.id === resultId) ??
    null
}

export function workbenchDisplayStatusOf(
  result: EcommerceResultRecord,
  args: {
    run?: { createdAt: number; status: string }
    task?: EcommerceTaskRecord
  },
): EcommerceDisplayResultStatus {
  if (result.status === 'running' && (!args.run || result.updatedAt >= args.run.createdAt)) return 'running'
  if (args.run?.status === 'failed' || args.run?.status === 'canceled') return 'failed'
  if (args.run?.status === 'succeeded') return result.assetHash ? 'done' : 'failed'
  const terminal = args.task && (
    args.task.status === 'done' ||
    args.task.status === 'partial' ||
    args.task.status === 'failed' ||
    args.task.status === 'canceled'
  )
  if (terminal && (result.status === 'pending' || result.status === 'running')) {
    return result.assetHash ? 'done' : 'failed'
  }
  return resultDisplayStatus({ stored: result.status, hasAsset: Boolean(result.assetHash) })
}
