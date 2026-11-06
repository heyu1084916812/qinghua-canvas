import type { Channel } from '../../../domain/project/channel'
import type { GenerationRoutingRecipe } from '../../../domain/project/generationRouting'
import { resolveGenerationTarget } from '../../../domain/project/generationRouting'
import type { RouteStrategy } from '../../../domain/project/modelRouting'
import type { ProtocolCatalog } from '../../../domain/project/protocol'
import { imagePromptForModel } from '../../../domain/ecommerce/imagePromptProfile'
import { buildEcommercePlan } from '../../../domain/ecommerce/plan'
import type { EcommercePlatform } from '../../../domain/ecommerce/platforms'
import type {
  EcommerceGenerationPhase,
  EcommerceGenerationStage,
} from '../../../domain/ecommerce/progress'
import type { EcommerceShot } from '../../../domain/ecommerce/prompt'
import { shouldExpandShots } from '../../../domain/ecommerce/chatShots'
import type {
  EcommerceResultRecord,
  EcommerceTaskRecord,
} from '../../../domain/ecommerce/tasks'
import { ecommerceAspectRatio, type EcommerceRequest } from '../../../domain/ecommerce/types'
import type { RunPlan } from '../../../domain/shared/execution/plan'
import type { NodeInput } from '../../../domain/shared/execution/types'
import {
  buildEcommerceRunPlan,
  type EcommerceRunTask,
} from '../../../features/ecommerce/execution/ecommerceRunPlan'
import {
  acquireEcommerceTaskLease,
  releaseEcommerceTaskLease,
} from '../../../features/ecommerce/execution/taskLease'
import {
  ecommerceSubjectId,
  type LegacyGenerationNode,
} from '../ecommercePageSupport'
import {
  refreshEcommerceTask,
  type EcommercePageDataPorts,
} from './pageDataCoordinator'
import { runStoredResultRerun } from './pageResultActionCoordinator'
import { prescribeEcommerceShots } from './pageResultProjection'
import type { EcommerceChatTarget } from './pageAiRequests'
import type { ShotPlanResult } from '../../../domain/ecommerce/chatShots'
import type { EcommerceTaskRepository } from '../../../state/project/ecommerceTaskRepository'

type AssetInput = Extract<NodeInput, { kind: 'asset' }>
type GenerationStageState = EcommerceGenerationStage | null
type GenerationStageUpdate =
  | GenerationStageState
  | ((current: GenerationStageState) => GenerationStageState)

export interface PageGenerationLineage {
  sourceTaskId?: string
  sourceResultId?: string
  sourceAssetHash?: string
}

export interface PageGenerationStatePort {
  setSubmitting(submitting: boolean): void
  setShotPlanNote(note: string): void
  setPreparingShots(preparing: boolean): void
  setGenerationStage(update: GenerationStageUpdate): void
  setGenerationFailed(message: string): void
  setActiveTask(task: EcommerceTaskRecord): void
  setResultRows(
    rows:
      | EcommerceResultRecord[]
      | ((current: EcommerceResultRecord[]) => EcommerceResultRecord[]),
  ): void
}

export type PageGenerationTaskPort = Pick<
  EcommerceTaskRepository,
  | 'create'
  | 'results'
  | 'appendResults'
  | 'updateResult'
  | 'retrySave'
  | 'updateTask'
  | 'reconcileFromRunRecords'
>

export interface PageGenerationActionPorts {
  projectId: string
  activeTask: EcommerceTaskRecord | null
  taskHistory: readonly EcommerceTaskRecord[]
  workbenchResults: readonly EcommerceResultRecord[]
  resultRows: readonly EcommerceResultRecord[]
  platforms: readonly EcommercePlatform[]
  channels: readonly Channel[]
  channelStore: {
    defaultForNewNode(
      node: { channelId?: string; model?: string },
      category: string,
    ): Promise<GenerationRoutingRecipe & {
      params: Record<string, unknown>
      substituted: boolean
    } | null>
    protocolCatalog(): ProtocolCatalog
  }
  strategy?: RouteStrategy
  chatTarget: EcommerceChatTarget | null
  nodes: readonly LegacyGenerationNode[]
  taskRepo: PageGenerationTaskPort
  reconcile(projectId: string): Promise<unknown>
  canvasSaveQueue(): Promise<void>
  canvasRepo: EcommercePageDataPorts['canvasRepo']
  runLogs: EcommercePageDataPorts['runLogs']
  assets: {
    read(hash: string): Promise<{ mime: string } | null>
  }
  execution: {
    run(plan: RunPlan<EcommerceRunTask>): Promise<{ warnings: readonly string[] }>
  }
  logger: {
    log(level: string, message: string, details?: unknown): void
  }
  refresh: {
    history(): Promise<void>
    workbench(): Promise<void>
  }
  requestShots(
    request: EcommerceRequest,
    chatTarget: EcommerceChatTarget,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<ShotPlanResult>
  visualInputsFor(
    request: EcommerceRequest,
    nodes: readonly LegacyGenerationNode[],
  ): Promise<readonly AssetInput[]>
  nextBatchId(): string
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
  state: PageGenerationStatePort
}

export interface PageGenerationActionCoordinator {
  onGenerate(
    request: EcommerceRequest,
    shotPlan?: readonly EcommerceShot[],
    lineage?: PageGenerationLineage,
  ): Promise<void>
  refreshTask(task: EcommerceTaskRecord): Promise<void>
  runStoredResult(
    row: EcommerceResultRecord,
    options?: { inPlace?: boolean },
  ): Promise<void>
  retrySaveWorkbenchResult(resultId: string): Promise<void>
  retryWorkbenchResult(resultId: string): Promise<void>
}

const waitForPoll = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

const terminalResultCount = (rows: readonly EcommerceResultRecord[]): number =>
  rows.filter(
    (row) =>
      row.status === 'done' ||
      row.status === 'failed' ||
      row.status === 'canceled',
  ).length

export function createPageGenerationActionCoordinator(
  ports: PageGenerationActionPorts,
): PageGenerationActionCoordinator {
  const now = ports.now ?? Date.now
  const wait = ports.wait ?? waitForPoll
  const setStage = (
    phase: EcommerceGenerationPhase,
    label: string,
    values: Omit<EcommerceGenerationStage, 'phase' | 'label'> = {},
  ) => ports.state.setGenerationStage({ phase, label, ...values })

  const refreshTask = async (task: EcommerceTaskRecord): Promise<void> => {
    const refreshed = await refreshEcommerceTask({
      projectId: ports.projectId,
      canvasSaveQueue: ports.canvasSaveQueue(),
      taskRepo: ports.taskRepo as unknown as EcommercePageDataPorts['taskRepo'],
      canvasRepo: ports.canvasRepo,
      runLogs: ports.runLogs,
    }, task)
    ports.state.setActiveTask(refreshed.task)
    ports.state.setResultRows(refreshed.rows)
  }

  const runStoredResult = (
    row: EcommerceResultRecord,
    options: { inPlace?: boolean } = {},
  ): Promise<void> =>
    runStoredResultRerun({
      activeTask: ports.activeTask,
      taskHistory: ports.taskHistory,
      row,
      inPlace: options.inPlace,
      channels: ports.channels,
      catalog: ports.channelStore.protocolCatalog(),
      strategy: ports.strategy,
      nodes: ports.nodes,
      taskRepo: ports.taskRepo,
      execution: ports.execution,
      assets: ports.assets,
      logger: ports.logger,
      lease: {
        acquire: acquireEcommerceTaskLease,
        release: releaseEcommerceTaskLease,
      },
      refresh: {
        task: refreshTask,
        history: ports.refresh.history,
        workbench: ports.refresh.workbench,
      },
      state: {
        setActiveTask: ports.state.setActiveTask,
        setResultRows: ports.state.setResultRows,
      },
      visualInputsFor: ports.visualInputsFor,
      subjectId: ecommerceSubjectId,
    })

  const retrySaveWorkbenchResult = async (resultId: string): Promise<void> => {
    const outcome = await ports.taskRepo.retrySave(resultId)
    await ports.refresh.workbench()
    if (!outcome.ok) {
      ports.logger.log('warn', '[ecommerce] 重试保存仍未成功', {
        resultId,
        error: outcome.errorText ?? 'unknown',
      })
    }
  }

  const retryWorkbenchResult = async (resultId: string): Promise<void> => {
    const row =
      ports.workbenchResults.find((result) => result.id === resultId) ??
      ports.resultRows.find((result) => result.id === resultId)
    if (!row) return
    if (row.recovery === 'retry-save') {
      await retrySaveWorkbenchResult(resultId)
      return
    }
    await runStoredResult(row, { inPlace: true })
  }

  const runBackground = (task: EcommerceTaskRecord, plan: RunPlan<EcommerceRunTask>) => {
    void (async () => {
      const total = plan.tasks.length
      const startedAt = now()
      try {
        const execution = ports.execution.run(plan)
        void execution
          .then((outcome) => {
            for (const warning of outcome.warnings) {
              ports.logger.log('warn', '[ecommerce] 结果落库 / 投影警告', { warning })
            }
          })
          .catch((error: unknown) => {
            ports.logger.log('warn', '[ecommerce] 执行失败', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
        await Promise.resolve()
        while (now() - startedAt < 10 * 60_000) {
          await ports.reconcile(ports.projectId)
          const rows = await ports.taskRepo.results(task.id)
          const completed = terminalResultCount(rows)
          ports.state.setGenerationStage((current) =>
            current?.phase === 'done'
              ? current
              : {
                  phase: 'generate',
                  label: `正在生成 ${completed}/${total}`,
                  current: completed,
                  total,
                },
          )
          if (completed >= total) break
          await wait(250)
        }
        await refreshTask(task)
        await ports.refresh.history()
        await ports.refresh.workbench()
        setStage('done', `本批已结束 ${total}/${total}`, { current: total, total })
      } catch (error) {
        ports.state.setGenerationFailed(
          error instanceof Error ? error.message : '生成失败',
        )
      } finally {
        releaseEcommerceTaskLease(task.id)
      }
    })()
  }

  const onGenerate = async (
    request: EcommerceRequest,
    shotPlan?: readonly EcommerceShot[],
    lineage?: PageGenerationLineage,
  ): Promise<void> => {
    ports.state.setSubmitting(true)
    ports.state.setShotPlanNote('')
    setStage('validate', '正在检查素材与参数')
    try {
      let plan = buildEcommercePlan(request, { platforms: ports.platforms })
      const usablePlan = shotPlan && shotPlan.length === request.count ? shotPlan : null
      if (usablePlan) {
        plan = buildEcommercePlan(request, { platforms: ports.platforms, shots: usablePlan })
        ports.state.setShotPlanNote(`这 ${request.count} 张使用已确认的逐张方案。`)
        setStage('prompts', '正在采用已确认的逐张提示词')
      } else if (shouldExpandShots(request)) {
        if (!ports.chatTarget) {
          throw new Error(
            '没有可用的对话模型：无法先分析商品原图并写逐张提示词。为避免把策划文案直接送去生图，本轮未生成。',
          )
        }
        ports.state.setPreparingShots(true)
        try {
          setStage('analyze', '正在分析商品图并写逐张提示词')
          const out = await ports.requestShots(request, ports.chatTarget, ports.nodes)
          if (!out.ok) {
            throw new Error(`商品分析或逐张提示词生成失败：${out.error}`)
          }
          plan = buildEcommercePlan(request, {
            platforms: ports.platforms,
            shots: out.shots,
          })
          ports.state.setShotPlanNote(
            `已分析商品图，并由 ${ports.chatTarget.logicalModel} 生成 ${request.count} 条不同的最终提示词。`,
          )
        } finally {
          ports.state.setPreparingShots(false)
        }
      } else {
        setStage(
          'prompts',
          request.usage === 'white-bg'
            ? '正在准备白底图抽卡提示词'
            : '正在准备编辑提示词',
        )
      }

      const mediaKind = request.mediaKind ?? 'image'
      const recipe = await ports.channelStore.defaultForNewNode({}, mediaKind)
      const target = resolveGenerationTarget({
        channels: ports.channels,
        category: mediaKind,
        catalog: ports.channelStore.protocolCatalog(),
        strategy: ports.strategy,
        ...(request.model ? { logicalModel: request.model } : {}),
        ...(request.channelId ? { channelId: request.channelId } : {}),
        recipe,
      })
      if (!target) {
        throw new Error(
          request.model
            ? `所选模型「${request.model}」没有可用的真实${mediaKind === 'video' ? '视频' : '生图'}渠道`
            : mediaKind === 'video'
              ? '还没有可用的视频模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上视频模型'
              : '还没有可用的生图模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上模型',
        )
      }

      const prescribed = prescribeEcommerceShots({
        count: plan.count,
        planPrompts: plan.prompts,
        fallbackPrompt: plan.prompt,
        ratio: plan.ratio,
        shots: plan.shots,
        mediaKind,
        request,
        model: target.logicalModel,
        imagePromptForModel,
        aspectRatioOf: ecommerceAspectRatio,
      })
      setStage('workflow', '正在建立结果记录')
      const effectiveRequest: EcommerceRequest = {
        ...request,
        resolvedModel: target.logicalModel,
        resolvedChannelId: target.channelId,
      }
      const createdTask = await ports.taskRepo.create({
        projectId: ports.projectId,
        batchId: ports.nextBatchId(),
        request: effectiveRequest,
        nodeIds: prescribed.map(() => ecommerceSubjectId()),
        metadata: prescribed.map((item) => item.metadata),
        ...(lineage?.sourceTaskId ? { sourceTaskId: lineage.sourceTaskId } : {}),
        ...(lineage?.sourceResultId ? { sourceResultId: lineage.sourceResultId } : {}),
        ...(lineage?.sourceAssetHash ? { sourceAssetHash: lineage.sourceAssetHash } : {}),
      })
      const task = createdTask.task
      ports.state.setActiveTask(task)
      ports.state.setResultRows(createdTask.results)
      acquireEcommerceTaskLease(task.id)

      let runPlan: RunPlan<EcommerceRunTask>
      try {
        await ports.refresh.workbench()
        runPlan = buildEcommerceRunPlan({
          taskId: task.id,
          mediaKind,
          channelId: target.channelId,
          model: target.upstreamModel,
          logicalModel: target.logicalModel,
          ...(target.credentialGroupId
            ? { credentialGroupId: target.credentialGroupId }
            : {}),
          ...(target.credentialGroupIds?.length
            ? { credentialGroupIds: target.credentialGroupIds }
            : {}),
          inputs: await ports.visualInputsFor(request, ports.nodes),
          shots: createdTask.results.map((row, index) => {
            const prescribedShot = prescribed[index]
            return {
              resultId: row.id,
              subjectId: row.nodeId,
              prompt: prescribedShot?.prompt ?? (plan.prompts[index] ?? plan.prompt),
              params: prescribedShot?.params ?? {},
              metadata: prescribed[index]?.metadata ?? {},
            }
          }),
        })
      } catch (error) {
        releaseEcommerceTaskLease(task.id)
        throw error
      }

      const total = runPlan.tasks.length
      setStage('generate', `正在生成 0/${total}`, { current: 0, total })
      runBackground(task, runPlan)
    } catch (error) {
      ports.state.setGenerationFailed(
        error instanceof Error ? error.message : '生成失败',
      )
      throw error
    } finally {
      ports.state.setSubmitting(false)
    }
  }

  return {
    onGenerate,
    refreshTask,
    runStoredResult,
    retrySaveWorkbenchResult,
    retryWorkbenchResult,
  }
}
