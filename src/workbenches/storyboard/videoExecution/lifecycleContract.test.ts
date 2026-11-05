import { describe, expect, it, vi } from 'vitest'
import type { ChannelStore } from '../../../state/channel/channelStore'
import type {
  StoryboardCanvasEdge,
  StoryboardCanvasNode,
  StoryboardProjectionPort,
} from '../../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardRunPlan } from '../../../domain/storyboard/runTypes'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../../domain/storyboard/storyboard'
import type { RunTaskState } from '../../../features/shared/execution/runEngine'
import { createMemoryStorage } from '../../../platform/memory'
import { createStoryboardVideoExecutionController } from '../useStoryboardVideoExecutionController'
import {
  createStoryboardActionStateStore,
  type StoryboardActionStateStore,
} from '../useStoryboardActionState'

type Outcome = Awaited<ReturnType<StoryboardExecutionApi['run']>>

function fixture(label: string): {
  doc: StoryboardDoc
  shot: StoryboardShot
  nodes: StoryboardCanvasNode[]
} {
  let doc = emptyStoryboard(`project-${label}`, 1)
  doc = addEpisode(doc)
  const episodeId = doc.episodes[0]!.id
  doc = addShot(doc, episodeId)
  doc = {
    ...doc,
    shots: doc.shots.map((shot) => ({
      ...shot,
      nodeId: `image-${label}`,
      imageHash: `image-hash-${label}`,
      scene: `镜头 ${label}`,
    })),
  }
  return {
    doc,
    shot: doc.shots[0]!,
    nodes: [
      {
        id: `image-${label}`,
        type: 'generation',
        x: 10,
        y: 20,
        w: 200,
        h: 200,
        parentId: null,
        data: { assetMime: 'image/png' },
      } as StoryboardCanvasNode,
    ],
  }
}

function successOutcome(plan: StoryboardRunPlan, hash: string): Outcome {
  const state: RunTaskState = {
    kind: 'succeeded',
    result: [{ hash, mime: 'video/mp4', bytes: new Uint8Array([1]) }],
    duration: 10,
  }
  return {
    summary: {
      runPlanId: plan.id,
      mode: plan.mode,
      taskResults: plan.tasks.map((task) => ({
        taskId: task.id,
        nodeId: task.nodeId,
        state,
      })),
      succeeded: plan.tasks.length,
      failed: 0,
      canceled: 0,
      startedAt: 1,
      finishedAt: 11,
      records: [],
    },
    warnings: [],
    failures: [],
  }
}

function canceledOutcome(plan: StoryboardRunPlan): Outcome {
  return {
    summary: {
      runPlanId: plan.id,
      mode: plan.mode,
      taskResults: plan.tasks.map((task) => ({
        taskId: task.id,
        nodeId: task.nodeId,
        state: { kind: 'canceled' } satisfies RunTaskState,
      })),
      succeeded: 0,
      failed: 0,
      canceled: plan.tasks.length,
      startedAt: 1,
      finishedAt: 11,
      records: [],
    },
    warnings: [],
    failures: [],
  }
}

function producedDoc(doc: StoryboardDoc, hash: string): StoryboardDoc {
  return {
    ...doc,
    shots: doc.shots.map((shot) => ({ ...shot, videoHash: hash })),
  }
}

function harness(options: {
  label?: string
  actionState?: StoryboardActionStateStore
  runImpl?: (plan: StoryboardRunPlan) => Promise<Outcome>
  cancelImpl?: (planId?: string) => void
  order?: string[]
} = {}) {
  const label = options.label ?? 'a'
  const { doc, shot, nodes } = fixture(label)
  const hash = `video-${label}`
  const order = options.order ?? []
  const actionState = options.actionState ?? createStoryboardActionStateStore()
  const replaceDoc = vi.fn((next: StoryboardDoc) => {
    order.push('replaceDoc')
    void next
  })
  const setLay = vi.fn((value: unknown) => {
    order.push('status')
    void value
  })
  const run = vi.fn(
    options.runImpl ??
      (async (plan: StoryboardRunPlan) => {
        order.push('run')
        return successOutcome(plan, hash)
      }),
  )
  const cancel = vi.fn(options.cancelImpl ?? (() => {}))
  const createGenerationNode = vi.fn(() => `video-node-${label}`)
  const storage = createMemoryStorage()
  const query = storage.query.bind(storage)
  storage.query = (async (...args: Parameters<typeof query>) => {
    order.push('assetMime')
    return query(...args)
  }) as typeof storage.query
  const documents = {
    load: async () => {
      order.push('load')
      return producedDoc(doc, hash)
    },
    save: async () => {},
  } as StoryboardDocumentPort
  const projection = {
    createGenerationNode,
    updateNodeData: vi.fn(),
    connectEdge: vi.fn(),
    removeEdge: vi.fn(),
    beginPlan: vi.fn(),
    endPlan: vi.fn(),
    resolveGenerationData: async (data: Record<string, unknown>) => {
      order.push('projection')
      return data
    },
  } as unknown as StoryboardProjectionPort
  const controller = createStoryboardVideoExecutionController({
    currentDoc: () => {
      order.push('currentDoc')
      return doc
    },
    graphNodes: nodes,
    graphEdges: [] as StoryboardCanvasEdge[],
    liveNodeIds: new Set([`image-${label}`]),
    channels: {
      defaultForNewNode: async () => {
        order.push('model')
        return {
          channelId: `channel-${label}`,
          model: `video-model-${label}`,
          params: {},
          substituted: false,
        }
      },
      getState: () => ({
        channels: [
          {
            id: `channel-${label}`,
            modelMap: {},
            models: [],
            modelCache: [],
          },
        ],
      }),
    } as unknown as ChannelStore,
    storage,
    projection,
    execution: { run, cancel } as unknown as StoryboardExecutionApi,
    documents,
    projectId: doc.projectId,
    flush: async () => {
      order.push('flush')
    },
    replaceDoc,
    setLay,
    actionState,
  })
  return {
    actionState,
    cancel,
    controller,
    createGenerationNode,
    doc,
    hash,
    order,
    replaceDoc,
    run,
    setLay,
    shot,
  }
}

describe('storyboard video execution / lifecycle feature contract', () => {
  it('keeps the public action keys and first-run execution order', async () => {
    const order: string[] = []
    const h = harness({ order })
    expect(Object.keys(h.controller)).toEqual([
      'makeShotVideo',
      'runEpisodeVideos',
      'makeVideoUpscale',
      'makeVideoErase',
      'makeVideoEdit',
      'makeVideoExtend',
    ])
    expect(await h.controller.makeShotVideo(h.shot)).toBe(true)
    expect(order[0]).toBe('currentDoc')
    expect(order.indexOf('model')).toBeLessThan(order.indexOf('flush'))
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('run'))
    expect(order.indexOf('run')).toBeLessThan(order.indexOf('load'))
    expect(order.indexOf('load')).toBeLessThan(order.indexOf('projection'))
    expect(order.indexOf('projection')).toBeLessThan(order.indexOf('replaceDoc'))
    expect(order.indexOf('replaceDoc')).toBeLessThan(order.lastIndexOf('status'))
    expect(h.replaceDoc).toHaveBeenCalledTimes(1)
  })

  it('keeps switched controller instances isolated while sharing the action lease store', async () => {
    const actionState = createStoryboardActionStateStore()
    const a = harness({ label: 'a', actionState })
    const b = harness({ label: 'b', actionState })
    expect(await a.controller.makeShotVideo(a.shot)).toBe(true)
    expect(await b.controller.makeShotVideo(b.shot)).toBe(true)
    expect(a.replaceDoc.mock.calls[0]![0].shots[0]!.videoHash).toBe(a.hash)
    expect(b.replaceDoc.mock.calls[0]![0].shots[0]!.videoHash).toBe(b.hash)
    expect(a.replaceDoc.mock.calls[0]![0].projectId).toBe('project-a')
    expect(b.replaceDoc.mock.calls[0]![0].projectId).toBe('project-b')
    expect(actionState.getBusy().shotVideo).toEqual({})
  })

  it('clears its timeout on completion so an unmounted render leaves no active timer', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      expect(await h.controller.makeShotVideo(h.shot)).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
      expect(h.cancel).not.toHaveBeenCalled()
      expect(h.setLay).toHaveBeenLastCalledWith(
        expect.objectContaining({ kind: 'done' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the same plan id at 20 minutes and settles as canceled', async () => {
    vi.useFakeTimers()
    try {
      let plan: StoryboardRunPlan | undefined
      let resolveRun: ((outcome: Outcome) => void) | undefined
      let canceledPlanId = ''
      const h = harness({
        runImpl: (nextPlan) => {
          plan = nextPlan
          return new Promise<Outcome>((resolve) => {
            resolveRun = resolve
          })
        },
        cancelImpl: (planId) => {
          canceledPlanId = planId ?? ''
          if (plan && resolveRun) resolveRun(canceledOutcome(plan))
        },
      })
      const running = h.controller.runEpisodeVideos(h.doc.shots)
      await vi.advanceTimersByTimeAsync(0)
      expect(h.run).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
      expect(h.cancel).toHaveBeenCalledTimes(1)
      expect(canceledPlanId).toBe(plan?.id)
      await running
      expect(h.setLay).toHaveBeenLastCalledWith({
        kind: 'error',
        text: '这一集视频结束：成功 0 镜，取消 1 镜，失败 0 镜',
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the action lease after failure and allows a subsequent successful recovery', async () => {
    let attempts = 0
    const h = harness({
      runImpl: async (plan) => {
        attempts += 1
        if (attempts === 1) throw new Error('upstream unavailable')
        return successOutcome(plan, h.hash)
      },
    })
    expect(await h.controller.makeShotVideo(h.shot)).toBe(false)
    expect(h.actionState.isBusy('shot-video', h.shot.id)).toBe(false)
    expect(h.setLay).toHaveBeenLastCalledWith({
      kind: 'error',
      text: '这一镜的视频生成失败：upstream unavailable',
    })
    expect(await h.controller.makeShotVideo(h.shot)).toBe(true)
    expect(h.run).toHaveBeenCalledTimes(2)
    expect(h.replaceDoc).toHaveBeenCalledTimes(1)
    expect(h.replaceDoc.mock.calls[0]![0].shots[0]!.videoHash).toBe(h.hash)
    expect(h.actionState.isBusy('shot-video', h.shot.id)).toBe(false)
  })
})
