import {
  attachShotVideos,
  mergeStoryboardRunResults,
  setShotVideoNode,
} from '../../../domain/storyboard/storyboard'
import type { StoryboardShot } from '../../../domain/storyboard/storyboard'
import { describeError } from '../../../shared/result'
import { createId } from '../../../shared/id'
import { buildStoryboardRunPlan } from '../../../features/storyboard/execution/storyboardRunPlan'
import type { StoryboardRunPlan } from '../../../domain/storyboard/runTypes'
import type {
  PostprocessInput,
  PreparedShotVideo,
  RunOutcome,
  StoryboardRunPlan as Plan,
  VideoRunPorts,
} from './contracts'
import {
  assetMimeOf,
  buildShotVideoPlan,
  humanError,
  parentRunIdOf,
  prepareShotVideo,
} from './materialPreparation'
import { loadMergedDocument, projectVideoResults } from './resultProjection'

const EXECUTION_CANCEL_TIMEOUT_MS = 20 * 60 * 1000

export async function executePlan(
  ports: Pick<VideoRunPorts, 'execution' | 'flush'>,
  plan: StoryboardRunPlan,
): Promise<RunOutcome> {
  const timer = globalThis.setTimeout(
    () => ports.execution.cancel(plan.id),
    EXECUTION_CANCEL_TIMEOUT_MS,
  )
  try {
    await ports.flush()
    return await ports.execution.run(plan)
  } finally {
    globalThis.clearTimeout(timer)
  }
}

function singleTaskFailure(plan: Plan, outcome: RunOutcome): string | null {
  const task = plan.tasks[0]!
  const result = outcome.summary.taskResults.find(
    (item) => item.taskId === task.id,
  )?.state
  if (result?.kind !== 'succeeded') {
    return result?.kind === 'failed'
      ? describeError(result.error)
      : result?.kind === 'canceled'
        ? '视频生成已取消'
        : '视频生成没有返回可用结果'
  }
  const businessFailure = outcome.failures.find(
    (failure) => failure.taskId === task.id,
  )
  return businessFailure?.errorText ?? null
}

export async function runShotVideo(
  ports: VideoRunPorts,
  shot: StoryboardShot,
  quiet: boolean,
): Promise<boolean> {
  const report = (kind: 'running' | 'done' | 'error', text: string) => {
    if (!quiet) ports.report({ kind, text })
  }
  const document = ports.currentDoc()
  if (!document) {
    report('error', '漫剧文档还没有加载完成')
    return false
  }
  let prepared: PreparedShotVideo
  try {
    prepared = await prepareShotVideo(ports, shot, document)
  } catch (error) {
    report('error', humanError(error))
    return false
  }
  const plan = buildShotVideoPlan(document, [prepared])
  report(
    'running',
    prepared.includeEndFrame
      ? '这一镜的视频在跑（首尾帧：接到下一镜的画面）…'
      : prepared.nextFrameAvailable
        ? '这一镜的视频在跑（当前视频模型不支持首尾帧，按单张首帧生成）…'
        : '这一镜的视频在跑…',
  )
  try {
    const outcome = await executePlan(ports, plan)
    const failure = singleTaskFailure(plan, outcome)
    if (failure) throw new Error(failure)
    const merged = await loadMergedDocument(ports)
    const projectionResult = await projectVideoResults(
      ports,
      merged,
      plan,
      outcome,
      [prepared],
    )
    ports.replaceDoc(projectionResult.document)
    await ports.flush()
    report(
      'done',
      prepared.includeEndFrame
        ? '这一镜的视频已出（用了这一镜与下一镜的首尾帧）'
        : '这一镜的视频已出（画布里就挂在这一镜的图右边）',
    )
    return true
  } catch (error) {
    const message = humanError(error)
    report(
      'error',
      message.includes('视频节点没能建出来')
        ? message
        : `这一镜的视频生成失败：${message}`,
    )
    return false
  }
}

export async function runEpisodeVideoPlan(
  ports: VideoRunPorts,
  shots: readonly StoryboardShot[],
): Promise<void> {
  const targets = shots.filter((shot) => shot.imageHash && !shot.videoHash)
  if (targets.length === 0) {
    ports.report({
      kind: 'done',
      text: '这一集没有待出视频的镜头（要重出请用单镜那把）',
    })
    return
  }
  const document = ports.currentDoc()
  if (!document) {
    ports.report({ kind: 'error', text: '漫剧文档还没有加载完成' })
    return
  }
  let prepared: PreparedShotVideo[]
  try {
    prepared = []
    for (const shot of targets) {
      prepared.push(await prepareShotVideo(ports, shot, document))
    }
  } catch (error) {
    ports.report({ kind: 'error', text: humanError(error) })
    return
  }
  const plan = buildShotVideoPlan(document, prepared)
  ports.report({
    kind: 'running',
    text: `这一集出视频：${prepared.length} 镜已同时开始…`,
  })
  try {
    const outcome = await executePlan(ports, plan)
    const merged = await loadMergedDocument(ports)
    const projectionResult = await projectVideoResults(
      ports,
      merged,
      plan,
      outcome,
      prepared,
    )
    ports.replaceDoc(projectionResult.document)
    await ports.flush()
    const businessFailures = new Set(
      outcome.failures.map((failure) => failure.taskId),
    )
    let ok = 0
    let failed = 0
    let canceled = 0
    for (const task of plan.tasks) {
      const state = outcome.summary.taskResults.find(
        (item) => item.taskId === task.id,
      )?.state
      if (state?.kind === 'succeeded' && !businessFailures.has(task.id)) {
        ok += 1
      } else if (state?.kind === 'canceled') {
        canceled += 1
      } else {
        failed += 1
      }
    }
    ports.report({
      kind: failed > 0 || canceled > 0 ? 'error' : 'done',
      text:
        canceled > 0
          ? `这一集视频结束：成功 ${ok} 镜，取消 ${canceled} 镜，失败 ${failed} 镜`
          : failed > 0
            ? `这一集视频跑完：成功 ${ok} 镜，失败 ${failed} 镜（失败原因见各自状态）`
            : `这一集 ${ok} 镜视频已出`,
    })
  } catch (error) {
    ports.report({ kind: 'error', text: humanError(error) })
  }
}

export async function runPostprocessWithLease(
  ports: VideoRunPorts,
  input: PostprocessInput,
): Promise<boolean> {
  const document = ports.currentDoc()
  if (!document) {
    ports.report({ kind: 'error', text: '漫剧文档还没有加载完成' })
    return false
  }
  const sourceMime = await assetMimeOf(
    ports,
    input.shot.videoHash,
    (input.sourceNode?.data as { assetMime?: string } | undefined)?.assetMime ??
      'video/mp4',
  )
  const referenceMime = await assetMimeOf(
    ports,
    input.shot.imageHash,
    (input.referenceNode?.data as { assetMime?: string } | undefined)?.assetMime ??
      'image/png',
  )
  let parentRunId: string | undefined
  try {
    parentRunId = await parentRunIdOf(ports, input.shot)
  } catch (error) {
    ports.report({ kind: 'error', text: humanError(error) })
    return false
  }
  const plan = buildStoryboardRunPlan({
    doc: document,
    planId: createId('plan'),
    operationId: createId('op'),
    parentRunId,
    target: input.target,
    action: input.action,
    episodeId: input.shot.episodeId,
    shotIds: [input.shot.id],
    prompt: input.prompt,
    params: input.params,
    videoMime: sourceMime,
    referenceImageMime: referenceMime,
    includeReferenceImage: input.includeReferenceImage,
  })

  ports.report({ kind: 'running', text: input.runningText })
  const timer = globalThis.setTimeout(
    () => ports.execution.cancel(plan.id),
    EXECUTION_CANCEL_TIMEOUT_MS,
  )
  try {
    await ports.flush()
    const outcome = await ports.execution.run(plan)
    const failure = outcome.failures[0]
    if (failure) throw new Error(failure.errorText)
    const task = plan.tasks[0]!
    const result = outcome.summary.taskResults.find(
      (item) => item.taskId === task.id,
    )?.state
    if (result?.kind !== 'succeeded') {
      throw new Error(
        result?.kind === 'failed'
          ? describeError(result.error)
          : '视频后处理没有返回可用结果',
      )
    }
    const output = result.result[0]
    if (!output || !output.mime.toLowerCase().startsWith('video/')) {
      throw new Error('视频后处理没有返回视频产物')
    }

    const latest = await ports.documents.load(ports.projectId)
    const merged = mergeStoryboardRunResults(
      ports.currentDoc() ?? latest,
      latest,
      Date.now(),
    )
    let projected = merged
    if (input.sourceNode) {
      let videoNodeId = ''
      try {
        const data = await ports.projection.resolveGenerationData({
          mode: 'video',
          channelId: input.target.channelId,
          model: input.target.model,
          prompt: input.prompt,
          ...input.params,
          durationSec: input.shot.durationSec,
          assetHash: output.hash,
          assetMime: output.mime,
        })
        ports.projection.beginPlan(
          `storyboard:${input.action}`,
          input.transactionLabel,
        )
        try {
          videoNodeId =
            ports.projection.createGenerationNode({
              at: {
                x: input.sourceNode.x + 320,
                y: input.sourceNode.y,
              },
              data,
            }) ?? ''
          if (videoNodeId && input.shot.videoNodeId) {
            ports.projection.connectEdge(input.shot.videoNodeId, videoNodeId)
          }
          if (videoNodeId && input.referenceNode) {
            ports.projection.connectEdge(input.referenceNode.id, videoNodeId)
          }
        } finally {
          ports.projection.endPlan()
        }
        if (videoNodeId) {
          projected = setShotVideoNode(merged, input.shot.id, videoNodeId, 0)
        }
      } catch (error) {
        console.warn(
          '[storyboard] video postprocess projection skipped:',
          humanError(error),
        )
      }
    }
    ports.replaceDoc(
      attachShotVideos(
        projected,
        [{ shotId: input.shot.id, hash: output.hash }],
        0,
      ),
    )
    ports.report({ kind: 'done', text: input.successText })
    return true
  } catch (error) {
    ports.report({ kind: 'error', text: humanError(error) })
    return false
  } finally {
    globalThis.clearTimeout(timer)
  }
}

export function sourceNodeOf(
  ports: Pick<VideoRunPorts, 'graphNodes'>,
  shot: StoryboardShot,
) {
  return shot.videoNodeId
    ? ports.graphNodes.find((node) => node.id === shot.videoNodeId)
    : undefined
}
