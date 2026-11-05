import {
  videoUpscaleActionOf,
} from '../../domain/storyboard/videoUpscale'
import type {
  StoryboardVideoExecutionControllerArgs,
  VideoEditTarget,
  VideoEraseTarget,
  VideoExtendTarget,
  VideoUpscaleTarget,
} from './videoExecution/contracts'
import {
  runEpisodeVideoPlan,
  runPostprocessWithLease,
  runShotVideo,
  sourceNodeOf,
} from './videoExecution/executionState'

export type {
  VideoUpscaleTarget,
  VideoEraseTarget,
  VideoEditTarget,
  VideoExtendTarget,
  StoryboardVideoExecutionControllerArgs,
}

export function createStoryboardVideoExecutionController(
  args: StoryboardVideoExecutionControllerArgs,
) {
  const report: (value: {
    kind: 'idle' | 'running' | 'done' | 'error'
    text: string
  }) => void = (value) => args.setLay(value)
  const ports = { ...args, report }

  const makeShotVideo = async (
    shot: Parameters<typeof runShotVideo>[1],
    options: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    const lease = args.actionState.tryAcquire('shot-video', shot.id)
    if (!lease) return false
    try {
      return await runShotVideo(ports, shot, options.quiet === true)
    } finally {
      lease.release()
    }
  }

  const runEpisodeVideos = async (
    shots: Parameters<typeof runEpisodeVideoPlan>[1],
  ): Promise<void> => {
    const document = args.currentDoc()
    const episodeId = document ? shots[0]?.episodeId : undefined
    if (!episodeId) {
      await runEpisodeVideoPlan(ports, shots)
      return
    }
    const lease = args.actionState.tryAcquire('episode-video', episodeId)
    if (!lease) return
    try {
      await runEpisodeVideoPlan(ports, shots)
    } finally {
      lease.release()
    }
  }

  const runPostprocess = async (
    input: Parameters<typeof runPostprocessWithLease>[1],
  ) => {
    const lease = args.actionState.tryAcquire(input.busyKind, input.shot.id)
    if (!lease) return false
    try {
      return await runPostprocessWithLease(ports, input)
    } finally {
      lease.release()
    }
  }

  const makeVideoUpscale = async (
    shot: Parameters<typeof makeShotVideo>[0],
    target: VideoUpscaleTarget,
    resolution: string,
    frameRate: number | null,
  ) => {
    if (!shot.videoHash) {
      args.setLay({ kind: 'error', text: '这一镜还没有可超清的视频节点' })
      return
    }
    const sourceNode = sourceNodeOf(args, shot)
    const action = videoUpscaleActionOf(target.model)
    const actionLabel = action === 'fps' ? '补帧' : '超清'
    await runPostprocess({
      shot,
      action: action === 'fps' ? 'video-fps' : 'video-upscale',
      target: { channelId: target.channelId, model: target.model },
      prompt: `视频${actionLabel}`,
      params: {
        ...(resolution ? { resolution } : {}),
        ...(frameRate !== null ? { fps: String(frameRate) } : {}),
      },
      sourceNode,
      runningText: `正在用 ${target.model} 处理这一镜…`,
      successText:
        action === 'fps'
          ? '这一镜的视频补帧已完成'
          : `这一镜已生成 ${resolution}${frameRate !== null ? ` · ${frameRate}fps` : ''} 超清视频`,
      transactionLabel: `镜头视频${actionLabel}`,
      busyKind: 'video-upscale',
    })
  }

  const makeVideoErase = async (
    shot: Parameters<typeof makeShotVideo>[0],
    target: VideoEraseTarget,
  ) => {
    if (!shot.videoHash) {
      args.setLay({ kind: 'error', text: '这一镜还没有可擦除字幕的视频节点' })
      return
    }
    await runPostprocess({
      shot,
      action: 'video-erase',
      target: { channelId: target.channelId, model: target.model },
      prompt: '',
      params: {},
      sourceNode: sourceNodeOf(args, shot),
      runningText: `正在用 ${target.model} 擦除这一镜的字幕…`,
      successText: '这一镜的字幕已擦除，新视频已保存',
      transactionLabel: '镜头视频字幕擦除',
      busyKind: 'video-erase',
    })
  }

  const makeVideoEdit = async (
    shot: Parameters<typeof makeShotVideo>[0],
    target: VideoEditTarget,
    instruction: string,
    resolution: string,
    useReferenceImage: boolean,
  ) => {
    const prompt = instruction.trim()
    if (!prompt) {
      args.setLay({ kind: 'error', text: '先写清这段视频要改什么' })
      return
    }
    if (!shot.videoHash) {
      args.setLay({ kind: 'error', text: '这一镜还没有可编辑的视频节点' })
      return
    }
    const referenceNode =
      useReferenceImage && shot.nodeId
        ? args.graphNodes.find((node) => node.id === shot.nodeId)
        : null
    if (
      useReferenceImage &&
      (!target.supportsReferenceImage || !shot.imageHash)
    ) {
      args.setLay({ kind: 'error', text: '这一镜没有可引用的画面，取消参考图后再试' })
      return
    }
    if (target.requiresReferenceImage && !useReferenceImage) {
      args.setLay({ kind: 'error', text: '这个模型必须参考当前镜头画面' })
      return
    }
    await runPostprocess({
      shot,
      action: 'video-edit',
      target: { channelId: target.channelId, model: target.model },
      prompt,
      params: resolution ? { resolution } : {},
      includeReferenceImage: useReferenceImage,
      sourceNode: sourceNodeOf(args, shot),
      referenceNode,
      runningText: `正在用 ${target.model} 编辑这一镜…`,
      successText: resolution
        ? `这一镜的视频已按 ${resolution} 编辑完成${useReferenceImage ? '（已参考当前画面）' : ''}`
        : `这一镜的视频已编辑完成${useReferenceImage ? '（已参考当前画面）' : ''}`,
      transactionLabel: '镜头视频编辑',
      busyKind: 'video-edit',
    })
  }

  const makeVideoExtend = async (
    shot: Parameters<typeof makeShotVideo>[0],
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => {
    if (!shot.videoHash) {
      args.setLay({ kind: 'error', text: '这一镜还没有可续写的视频节点' })
      return
    }
    await runPostprocess({
      shot,
      action: 'video-extend',
      target: { channelId: target.channelId, model: target.model },
      prompt:
        instruction.trim() ||
        '延续当前镜头内容与运动，保持人物、场景和画风一致',
      params: {
        ...(resolution ? { resolution } : {}),
        ...(duration !== null ? { duration } : {}),
      },
      sourceNode: sourceNodeOf(args, shot),
      runningText: `正在用 ${target.model} 续写这一镜…`,
      successText:
        duration !== null
          ? `这一镜已续写 ${duration} 秒${resolution ? ` · ${resolution}` : ''}`
          : `这一镜已按 ${resolution} 续写完成`,
      transactionLabel: '镜头视频续写',
      busyKind: 'video-extend',
    })
  }

  return {
    makeShotVideo,
    runEpisodeVideos,
    makeVideoUpscale,
    makeVideoErase,
    makeVideoEdit,
    makeVideoExtend,
  }
}
