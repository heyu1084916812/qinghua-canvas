import type { EcommerceShot } from '../../../domain/ecommerce/prompt'
import type { Channel } from '../../../domain/project/channel'
import { resolveGenerationTarget as resolveGenerationTargetImpl } from '../../../domain/project/generationRouting'
import type { ProtocolCatalog } from '../../../domain/project/protocol'
import type { RouteStrategy } from '../../../domain/project/modelRouting'
import { resultMetadataOf, type EcommerceResultRecord, type EcommerceTaskRecord } from '../../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { NodeInput } from '../../../domain/shared/execution/types'
import { upscaleNoteOf, upscaleOptionOf, type EcommerceUpscaleProfile, type EcommerceUpscaleScale } from '../../../domain/ecommerce/upscale'
import { buildEcommerceRunPlan, type EcommerceRunTask } from '../../../features/ecommerce/execution/ecommerceRunPlan'
import { downloadAsset as downloadAssetImpl, type DownloadAssetDeps } from '../../../features/shared/assets/downloadAsset'
import type { EcommerceTaskRepository } from '../../../state/project/ecommerceTaskRepository'
import type { LegacyGenerationNode } from '../ecommercePageSupport'
import { prepareStoredResultRerun as prepareStoredResultRerunImpl, retryableResultIdsOf, type EcommerceStoredResultPorts } from './pageResultProjection'

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

type AssetInput = Extract<NodeInput, { kind: 'asset' }>
type ResultRowsSetter = (
  rows:
    | EcommerceResultRecord[]
    | ((current: EcommerceResultRecord[]) => EcommerceResultRecord[]),
) => void
type StoredResultTaskRepository = Pick<EcommerceTaskRepository, 'appendResults' | 'updateResult' | 'results'>

export interface StoredResultRerunPorts {
  activeTask: EcommerceTaskRecord | null
  taskHistory: readonly EcommerceTaskRecord[]
  row: EcommerceResultRecord
  inPlace?: boolean
  channels: readonly Channel[]
  catalog: ProtocolCatalog
  strategy?: RouteStrategy
  nodes: readonly LegacyGenerationNode[]
  taskRepo: StoredResultTaskRepository
  execution: {
    run(plan: RunPlan<EcommerceRunTask>): Promise<{ warnings: readonly string[] }>
  }
  assets: {
    read(hash: string): Promise<{ mime: string } | null>
  }
  logger: {
    log(level: string, message: string, details?: unknown): void
  }
  lease: {
    acquire(taskId: string): void
    release(taskId: string): void
  }
  refresh: {
    task(task: EcommerceTaskRecord): Promise<void>
    history(): Promise<void>
    workbench(): Promise<void>
  }
  state: {
    setActiveTask(task: EcommerceTaskRecord): void
    setResultRows: ResultRowsSetter
  }
  visualInputsFor(
    request: EcommerceRequest,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<readonly AssetInput[]>
  subjectId(): string
  now?: () => number
  prepareStoredResultRerun?: (
    ports: EcommerceStoredResultPorts,
  ) => ReturnType<typeof prepareStoredResultRerunImpl>
  resolveGenerationTarget?: typeof resolveGenerationTargetImpl
}

const sourceTaskOf = (
  activeTask: EcommerceTaskRecord | null,
  taskHistory: readonly EcommerceTaskRecord[],
  row: EcommerceResultRecord,
): EcommerceTaskRecord | null =>
  (activeTask?.id === row.taskId ? activeTask : null) ??
  taskHistory.find((task) => task.id === row.taskId) ??
  null

/**
 * Re-run an existing result row without creating a canvas node.
 *
 * The host owns React state, stores and platform instances; this module only
 * coordinates the persisted result row, execution plan and refresh order.
 */
export async function runStoredResultRerun(
  ports: StoredResultRerunPorts,
): Promise<void> {
  const sourceTask = sourceTaskOf(ports.activeTask, ports.taskHistory, ports.row)
  if (!sourceTask) throw new Error('找不到这张图所属的电商任务')

  const prepared = await (ports.prepareStoredResultRerun ?? prepareStoredResultRerunImpl)({
    activeTask: sourceTask,
    taskHistory: ports.taskHistory,
    row: ports.row,
    inPlace: ports.inPlace,
    now: (ports.now ?? Date.now)(),
    subjectId: ports.subjectId,
    taskRepo: ports.taskRepo,
  })
  const { task, targetRow, running } = prepared
  if (!ports.inPlace) {
    ports.state.setActiveTask(task)
    ports.state.setResultRows(await ports.taskRepo.results(task.id))
  }
  ports.state.setResultRows((rows) =>
    rows.map((item) => (item.id === running.id ? running : item)),
  )

  const mediaKind: 'image' | 'video' = task.request.mediaKind ?? 'image'
  const resolveTarget = ports.resolveGenerationTarget ?? resolveGenerationTargetImpl
  const target = resolveTarget({
    channels: ports.channels,
    category: mediaKind,
    catalog: ports.catalog,
    strategy: ports.strategy,
    logicalModel: task.request.resolvedModel ?? task.request.model,
    channelId: task.request.resolvedChannelId ?? task.request.channelId,
  })
  if (!target) throw new Error('这个结果对应的模型 / 渠道已经不可用')

  const inputs = [...(await ports.visualInputsFor(task.request, ports.nodes))]
  const sourceAssetHash = task.sourceAssetHash
  if (sourceAssetHash && !inputs.some((input) => input.assetHash === sourceAssetHash)) {
    const payload = await ports.assets.read(sourceAssetHash)
    if (payload) {
      inputs.push({
        kind: 'asset',
        nodeId: `result:${task.sourceResultId ?? ports.row.id}`,
        assetHash: sourceAssetHash,
        mime: payload.mime,
      })
    }
  }

  const params = {
    ratio: ports.row.ratio ?? task.request.ratio,
    count: 1,
    ...(task.request.resolution ? { resolution: task.request.resolution } : {}),
    ...(task.request.quality ? { quality: task.request.quality } : {}),
    ...(task.request.scale ? { scale: task.request.scale } : {}),
    ...(mediaKind === 'video' ? { durationSec: task.request.durationSec ?? 5 } : {}),
  }
  const plan = buildEcommerceRunPlan({
    taskId: task.id,
    mediaKind,
    channelId: target.channelId,
    model: target.upstreamModel,
    logicalModel: target.logicalModel,
    ...(target.credentialGroupId ? { credentialGroupId: target.credentialGroupId } : {}),
    ...(target.credentialGroupIds?.length
      ? { credentialGroupIds: target.credentialGroupIds }
      : {}),
    inputs,
    shots: [
      {
        resultId: targetRow.id,
        subjectId: targetRow.nodeId,
        prompt:
          ports.row.prompt?.trim() ||
          task.request.note?.trim() ||
          '按当前任务配置重新生成这张图',
        params,
        metadata: resultMetadataOf(ports.row),
      },
    ],
  })

  ports.lease.acquire(task.id)
  try {
    const outcome = await ports.execution.run(plan)
    for (const warning of outcome.warnings) {
      ports.logger.log('warn', '[ecommerce] 重跑结果落库 / 投影警告', { warning })
    }
    await ports.refresh.task(task)
    await ports.refresh.history()
    await ports.refresh.workbench()
  } finally {
    ports.lease.release(task.id)
  }
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
