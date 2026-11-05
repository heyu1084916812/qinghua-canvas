import { videoParamsFor } from '../../../domain/storyboard/videoParams'
import { shotsOf } from '../../../domain/storyboard/storyboard'
import type { StoryboardDoc, StoryboardShot } from '../../../domain/storyboard/storyboard'
import { createId } from '../../../shared/id'
import { asAppError, describeError } from '../../../shared/result'
import { buildStoryboardRunPlan } from '../../../features/storyboard/execution/storyboardRunPlan'
import type {
  PreparedShotVideo,
  StoryboardRunPlan,
  VideoRunPorts,
} from './contracts'

export async function assetMimeOf(
  ports: Pick<VideoRunPorts, 'storage'>,
  hash: string | undefined,
  fallback: string,
): Promise<string> {
  if (!hash) return fallback
  try {
    const rows = await ports.storage.query(
      'assets',
      { id: hash },
      { includePayload: false, fields: ['id', 'mime'] },
    )
    const mime = (rows[0] as { mime?: unknown } | undefined)?.mime
    return typeof mime === 'string' && mime.trim() ? mime.trim() : fallback
  } catch {
    return fallback
  }
}

export function humanError(error: unknown): string {
  const appError = asAppError(error)
  return appError
    ? describeError(appError)
    : error instanceof Error
      ? error.message
      : String(error)
}

export async function parentRunIdOf(
  ports: Pick<VideoRunPorts, 'storage' | 'projectId'>,
  shot: StoryboardShot,
): Promise<string | undefined> {
  const rows = await ports.storage.query('runRecords', {
    projectId: ports.projectId,
    workbench: 'storyboard',
    subjectId: `shot:${shot.id}`,
  })
  const allowed = new Set([
    'shot-video',
    'video-upscale',
    'video-fps',
    'video-erase',
    'video-edit',
    'video-extend',
    'digital-human',
  ])
  return rows
    .map((row) => row as unknown as {
      id?: unknown
      createdAt?: unknown
      status?: unknown
      params?: unknown
    })
    .filter((row) => {
      const action =
        row.params && typeof row.params === 'object'
          ? (row.params as Record<string, unknown>).action
          : undefined
      return (
        row.status === 'succeeded' &&
        typeof row.id === 'string' &&
        typeof action === 'string' &&
        allowed.has(action)
      )
    })
    .sort((left, right) =>
      Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
    )[0]?.id as string | undefined
}

export async function prepareShotVideo(
  ports: Pick<
    VideoRunPorts,
    'graphNodes' | 'liveNodeIds' | 'channels' | 'storage'
  >,
  shot: StoryboardShot,
  document: StoryboardDoc,
): Promise<PreparedShotVideo> {
  if (!shot.imageHash) {
    throw new Error('这一镜还没有图 —— 图生视频要先有画面，先点「出图」')
  }
  const imageNode = ports.graphNodes.find((node) => node.id === shot.nodeId)
  const existingVideoNode =
    shot.videoNodeId && ports.liveNodeIds.has(shot.videoNodeId)
      ? ports.graphNodes.find((node) => node.id === shot.videoNodeId)
      : undefined
  const recipe = await ports.channels.defaultForNewNode(
    existingVideoNode?.data as
      | { channelId?: string; model?: string }
      | undefined ?? {},
    'video',
  )
  if (!recipe?.channelId || !recipe.model) {
    throw new Error(
      '还没有可用的视频模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上视频模型',
    )
  }
  const liveChannel = ports.channels
    .getState()
    .channels.find((channel) => channel.id === recipe.channelId)
  const logicalModel =
    Object.entries(liveChannel?.modelMap ?? {}).find(
      ([, upstream]) => upstream === recipe.model,
    )?.[0] ?? recipe.model
  const videoSpec = videoParamsFor(logicalModel)
  const episodeShots = shotsOf(document, shot.episodeId)
  const shotIndex = episodeShots.findIndex((item) => item.id === shot.id)
  if (shotIndex < 0) throw new Error('这一镜已经从分集中删除')
  const nextShot = episodeShots[shotIndex + 1]
  const supportsFirstLastFrame =
    !!nextShot?.imageHash &&
    (videoSpec ? videoSpec.modes.includes('first-last-frame') : true)
  const nextImageNode =
    nextShot?.imageHash &&
    nextShot.nodeId &&
    ports.liveNodeIds.has(nextShot.nodeId)
      ? ports.graphNodes.find((node) => node.id === nextShot.nodeId)
      : undefined
  const endFrameNodeId = supportsFirstLastFrame ? nextImageNode?.id ?? '' : ''
  const singleImageMode = videoSpec?.modes.includes('image-to-video')
    ? 'image-to-video'
    : videoSpec?.modes.includes('all-purpose')
      ? 'all-purpose'
      : undefined
  return {
    shot,
    channelId: recipe.channelId,
    model: recipe.model,
    params: recipe.params,
    ...((supportsFirstLastFrame ? 'first-last-frame' : singleImageMode)
      ? {
          videoMode: supportsFirstLastFrame
            ? 'first-last-frame'
            : singleImageMode,
        }
      : {}),
    endFrameNodeId,
    ...(supportsFirstLastFrame && nextShot ? { endFrameShot: nextShot } : {}),
    includeEndFrame: supportsFirstLastFrame,
    nextFrameAvailable: !!nextShot?.imageHash,
    imageNode,
    imageMime: await assetMimeOf(
      ports,
      shot.imageHash,
      (imageNode?.data as { assetMime?: string } | undefined)?.assetMime ??
        'image/png',
    ),
    endFrameMime: await assetMimeOf(
      ports,
      nextShot?.imageHash,
      (nextImageNode?.data as { assetMime?: string } | undefined)?.assetMime ??
        'image/png',
    ),
  }
}

export function buildShotVideoPlan(
  document: StoryboardDoc,
  prepared: readonly PreparedShotVideo[],
): StoryboardRunPlan {
  const first = prepared[0]
  if (!first) throw new Error('漫剧执行计划没有匹配的镜头')
  if (prepared.some((item) => item.shot.episodeId !== first.shot.episodeId)) {
    throw new Error('同一个视频执行计划不能跨分集')
  }
  const byShotId = new Map(prepared.map((item) => [item.shot.id, item] as const))
  return buildStoryboardRunPlan({
    doc: document,
    planId: createId('plan'),
    operationId: createId('op'),
    target: ({ action, subject }) => {
      if (action !== 'shot-video' || subject.kind !== 'shot-video') {
        throw new Error('视频执行计划收到了错误的业务主体')
      }
      const item = byShotId.get(subject.shotId)
      if (!item) throw new Error(`镜头缺少执行模型：${subject.shotId}`)
      return {
        channelId: item.channelId,
        model: item.model,
        modelIsUpstream: false,
        params: {
          ...item.params,
          count: 1,
          ...(item.videoMode ? { videoMode: item.videoMode } : {}),
        },
      }
    },
    action: 'shot-video',
    episodeId: first.shot.episodeId,
    shotIds: prepared.map((item) => item.shot.id),
    shotVideoInputs: (shot, nextShot) => {
      const item = byShotId.get(shot.id)
      return {
        includeEndFrame:
          item?.includeEndFrame === true &&
          !!nextShot &&
          item.endFrameShot?.id === nextShot.id,
        ...(item ? { imageMime: item.imageMime } : {}),
        ...(item ? { endFrameMime: item.endFrameMime } : {}),
      }
    },
  })
}
