import {
  attachShotVideos,
  mergeStoryboardRunResults,
  setShotVideoNode,
  shotVideoPrompt,
} from '../../../domain/storyboard/storyboard'
import type { StoryboardDoc, StoryboardShot } from '../../../domain/storyboard/storyboard'
import type {
  PreparedShotVideo,
  RunOutcome,
  StoryboardRunPlan,
  VideoRunPorts,
} from './contracts'
import { humanError } from './materialPreparation'

interface PendingProjection {
  taskId: string
  shot: StoryboardShot
  prepared: PreparedShotVideo
  data: Record<string, unknown>
  hash: string
}

export async function loadMergedDocument(
  ports: Pick<VideoRunPorts, 'currentDoc' | 'documents' | 'projectId'>,
): Promise<StoryboardDoc> {
  const latest = await ports.documents.load(ports.projectId)
  return mergeStoryboardRunResults(ports.currentDoc() ?? latest, latest, Date.now())
}

export async function projectVideoResults(
  ports: Pick<
    VideoRunPorts,
    'graphEdges' | 'liveNodeIds' | 'projection' | 'currentDoc' | 'documents' | 'projectId'
  >,
  document: StoryboardDoc,
  plan: StoryboardRunPlan,
  outcome: RunOutcome,
  prepared: readonly PreparedShotVideo[],
): Promise<{ document: StoryboardDoc; warnings: string[] }> {
  const taskByShotId = new Map(
    plan.tasks.flatMap((task) =>
      task.subject.kind === 'shot-video'
        ? [[task.subject.shotId, task] as const]
        : [],
    ),
  )
  const businessFailures = new Set(outcome.failures.map((failure) => failure.taskId))
  const pending: PendingProjection[] = []
  const warnings: string[] = []
  for (const preparedItem of prepared) {
    const task = taskByShotId.get(preparedItem.shot.id)
    if (!task || businessFailures.has(task.id)) continue
    const state = outcome.summary.taskResults.find(
      (item) => item.taskId === task.id,
    )?.state
    if (state?.kind !== 'succeeded') continue
    const asset = state.result.find((item) =>
      item.mime.toLowerCase().startsWith('video/'),
    )
    if (!asset) continue
    const shot = document.shots.find((item) => item.id === preparedItem.shot.id)
    if (!shot || shot.videoHash !== asset.hash) continue
    const prompt = shotVideoPrompt(
      document,
      shot,
      preparedItem.includeEndFrame ? preparedItem.endFrameShot : undefined,
    )
    try {
      const data = await ports.projection.resolveGenerationData({
        mode: 'video',
        channelId: preparedItem.channelId,
        model: preparedItem.model,
        prompt,
        count: 1,
        durationSec: shot.durationSec,
        ...(preparedItem.videoMode ? { videoMode: preparedItem.videoMode } : {}),
        assetHash: asset.hash,
        assetMime: asset.mime,
      })
      pending.push({
        taskId: task.id,
        shot,
        prepared: preparedItem,
        data,
        hash: asset.hash,
      })
    } catch (error) {
      warnings.push(`video display defaults: ${humanError(error)}`)
    }
  }
  if (pending.length === 0) return { document, warnings }

  const nodeIdByTask = new Map<string, string>()
  try {
    ports.projection.beginPlan(
      plan.tasks.length > 1
        ? 'storyboard:episode-video'
        : 'storyboard:shot-video',
      plan.tasks.length > 1 ? '这一集出视频' : '这一镜出视频',
    )
    try {
      for (const item of pending) {
        let videoNodeId =
          item.shot.videoNodeId && ports.liveNodeIds.has(item.shot.videoNodeId)
            ? item.shot.videoNodeId
            : ''
        if (videoNodeId) {
          ports.projection.updateNodeData(videoNodeId, item.data)
        } else {
          videoNodeId =
            ports.projection.createGenerationNode({
              at: {
                x: (item.prepared.imageNode?.x ?? 40) + 280,
                y: item.prepared.imageNode?.y ?? 40,
              },
              data: item.data,
            }) ?? ''
        }
        if (!videoNodeId) continue
        const connected = new Set(
          ports.graphEdges
            .filter((edge) => edge.target === videoNodeId)
            .map((edge) => edge.source),
        )
        if (
          item.shot.videoEndNodeId &&
          item.shot.videoEndNodeId !== item.prepared.endFrameNodeId &&
          connected.has(item.shot.videoEndNodeId)
        ) {
          const old = ports.graphEdges.find(
            (edge) =>
              edge.source === item.shot.videoEndNodeId &&
              edge.target === videoNodeId,
          )
          if (old) {
            ports.projection.removeEdge(old.id)
            connected.delete(item.shot.videoEndNodeId)
          }
        }
        if (item.shot.nodeId && !connected.has(item.shot.nodeId)) {
          ports.projection.connectEdge(item.shot.nodeId, videoNodeId)
        }
        if (
          item.prepared.endFrameNodeId &&
          !connected.has(item.prepared.endFrameNodeId)
        ) {
          ports.projection.connectEdge(item.prepared.endFrameNodeId, videoNodeId)
        }
        nodeIdByTask.set(item.taskId, videoNodeId)
      }
    } finally {
      ports.projection.endPlan()
    }
  } catch (error) {
    warnings.push(`video projection: ${humanError(error)}`)
    nodeIdByTask.clear()
  }

  let projected = document
  for (const item of pending) {
    const videoNodeId = nodeIdByTask.get(item.taskId)
    if (!videoNodeId) continue
    projected = setShotVideoNode(
      projected,
      item.shot.id,
      videoNodeId,
      0,
      item.prepared.endFrameNodeId,
    )
  }
  return {
    document: attachShotVideos(
      projected,
      pending.map((item) => ({ shotId: item.shot.id, hash: item.hash })),
      0,
    ),
    warnings,
  }
}
