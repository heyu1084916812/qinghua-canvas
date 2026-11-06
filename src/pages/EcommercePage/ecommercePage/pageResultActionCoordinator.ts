import type { EcommerceShot } from '../../../domain/ecommerce/prompt'
import type {
  EcommerceResultRecord,
  EcommerceTaskRecord,
} from '../../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import {
  upscaleNoteOf,
  upscaleOptionOf,
  type EcommerceUpscaleProfile,
  type EcommerceUpscaleScale,
} from '../../../domain/ecommerce/upscale'
import {
  downloadAsset as downloadAssetImpl,
  type DownloadAssetDeps,
} from '../../../features/shared/assets/downloadAsset'
import { retryableResultIdsOf } from './pageResultProjection'

export interface PageResultActionLineage {
  sourceTaskId?: string
  sourceResultId?: string
  sourceAssetHash?: string
}

export interface PageResultActionView {
  nodeId: string
  resultId?: string
  status: 'running' | 'done' | 'failed'
  imageHash?: string
}

export interface PageResultActionChannel {
  enabled: boolean
  id: string
  models: readonly {
    id: string
    category?: string
  }[]
}

export interface PageResultActionPorts {
  activeTask: EcommerceTaskRecord | null
  resultRows: readonly EcommerceResultRecord[]
  results: readonly PageResultActionView[]
  channels: readonly PageResultActionChannel[]
  platform: DownloadAssetDeps
  onGenerate(
    request: EcommerceRequest,
    shotPlan?: readonly EcommerceShot[],
    lineage?: PageResultActionLineage,
  ): Promise<void>
  retryWorkbenchResult(resultId: string): Promise<void> | void
  downloadAsset?: typeof downloadAssetImpl
  wait?: (milliseconds: number) => Promise<void>
}

export interface PageResultActionCoordinator {
  editResult(
    nodeId: string,
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ): Promise<void>
  editResults(
    nodeIds: readonly string[],
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ): Promise<void>
  upscaleResult(
    nodeId: string,
    profile: EcommerceUpscaleProfile,
    scale: EcommerceUpscaleScale,
  ): Promise<void>
  downloadAll(): Promise<void>
  retryFailed(): Promise<void>
}

export interface ResultLibraryActionPorts {
  projectId: string
  platform: DownloadAssetDeps
  assetLibraryRepo: {
    save(row: {
      hash: string
      mime: string
      bytes: number
      width?: number
      height?: number
      savedAt: number
      projectId: string
      prompt?: string
      model?: string
      ratio?: string
    }): Promise<unknown>
  }
  logger: {
    log(level: string, message: string, details?: unknown): void
  }
  downloadAsset?: typeof downloadAssetImpl
}

export interface ResultLibraryActions {
  downloadOf(hash: string | undefined): (() => void) | undefined
  saveToLibraryOf(
    hash: string | undefined,
    meta: {
      width?: number
      height?: number
      prompt?: string
      model?: string
      ratio?: string
    },
  ): (() => Promise<void>) | undefined
}

const waitForDownload = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

const resultRowOf = (
  rows: readonly EcommerceResultRecord[],
  nodeId: string,
): EcommerceResultRecord | null =>
  rows.find((item) => item.nodeId === nodeId || item.canvasCopyNodeId === nodeId) ?? null

export function createResultLibraryActions(
  ports: ResultLibraryActionPorts,
): ResultLibraryActions {
  const download = ports.downloadAsset ?? downloadAssetImpl
  return {
    downloadOf: (hash) =>
      hash
        ? () => {
            void download(ports.platform, hash)
          }
        : undefined,
    saveToLibraryOf: (hash, meta) =>
      hash
        ? async () => {
            try {
              const payload = await ports.platform.assets.read(hash)
              if (!payload) return
              await ports.assetLibraryRepo.save({
                hash,
                mime: payload.mime,
                bytes: payload.bytes.length,
                ...(meta.width ? { width: meta.width } : {}),
                ...(meta.height ? { height: meta.height } : {}),
                savedAt: Date.now(),
                projectId: ports.projectId,
                ...(meta.prompt ? { prompt: meta.prompt } : {}),
                ...(meta.model ? { model: meta.model } : {}),
                ...(meta.ratio ? { ratio: meta.ratio } : {}),
              })
            } catch (error) {
              ports.logger.log('warn', '[ecommerce] 收藏结果失败', { error: String(error) })
            }
          }
        : undefined,
  }
}

export async function downloadAllResults(
  ports: Pick<PageResultActionPorts, 'results' | 'platform' | 'downloadAsset' | 'wait'>,
): Promise<void> {
  const download = ports.downloadAsset ?? downloadAssetImpl
  const wait = ports.wait ?? waitForDownload
  let index = 0
  for (const result of ports.results) {
    if (result.status !== 'done' || !result.imageHash) continue
    index += 1
    await download(ports.platform, result.imageHash, `轻画-电商-${index}`)
    await wait(250)
  }
}

export async function retryFailedResults(
  ports: Pick<
    PageResultActionPorts,
    'activeTask' | 'resultRows' | 'results' | 'retryWorkbenchResult'
  >,
): Promise<void> {
  const ids = retryableResultIdsOf(ports.activeTask, ports.resultRows, ports.results)
  if (ids.length === 0) return
  for (const resultId of ids) await ports.retryWorkbenchResult(resultId)
}

export function createPageResultActionCoordinator(
  ports: PageResultActionPorts,
): PageResultActionCoordinator {
  const editResult = async (
    nodeId: string,
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ): Promise<void> => {
    const row = resultRowOf(ports.resultRows, nodeId)
    if (!row) throw new Error('没找到这张结果对应的素材记录')
    if (!row.assetHash) throw new Error('这张结果还没有可编辑的素材')
    const text = instruction.trim()
    if (!text) throw new Error('先在左侧「补充要求」写清要换成的背景')
    await ports.onGenerate(
      {
        usage: 'edit',
        platformId: ports.activeTask?.request.platformId,
        language: ports.activeTask?.request.language ?? 'zh-CN',
        count: 1,
        ratio: ports.activeTask?.request.ratio ?? '1:1',
        productNodeId: row.assetHash,
        referenceNodeIds: options?.referenceNodeId ? [options.referenceNodeId] : [],
        note: text,
        ...(options?.model || row.model
          ? { model: options?.model || row.model }
          : {}),
      },
      undefined,
      {
        sourceTaskId: row.taskId,
        sourceResultId: row.id,
        ...(row.assetHash ? { sourceAssetHash: row.assetHash } : {}),
      },
    )
  }

  const editResults = async (
    nodeIds: readonly string[],
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ): Promise<void> => {
    for (const nodeId of nodeIds) await editResult(nodeId, instruction, options)
  }

  const upscaleResult = async (
    nodeId: string,
    profile: EcommerceUpscaleProfile,
    scale: EcommerceUpscaleScale,
  ): Promise<void> => {
    const row = resultRowOf(ports.resultRows, nodeId)
    if (!row?.assetHash) throw new Error('没找到这张结果的原始素材')
    const option = upscaleOptionOf(profile)
    const target = ports.channels.find(
      (channel) =>
        channel.enabled &&
        channel.models.some(
          (model) => model.id === option.model && model.category === 'image',
        ),
    )
    if (!target) {
      throw new Error(`当前没有可用的「${option.model}」渠道，请先在 RunningHub 勾选该模型`)
    }
    await ports.onGenerate(
      {
        usage: 'edit',
        channelId: target.id,
        platformId: ports.activeTask?.request.platformId,
        language: ports.activeTask?.request.language ?? 'zh-CN',
        count: 1,
        ratio: ports.activeTask?.request.ratio ?? '1:1',
        productNodeId: row.assetHash,
        referenceNodeIds: [],
        note: upscaleNoteOf(profile, scale),
        model: option.model,
        scale,
      },
      undefined,
      {
        sourceTaskId: row.taskId,
        sourceResultId: row.id,
        sourceAssetHash: row.assetHash,
      },
    )
  }

  return {
    editResult,
    editResults,
    upscaleResult,
    downloadAll: () => downloadAllResults(ports),
    retryFailed: () => retryFailedResults(ports),
  }
}
