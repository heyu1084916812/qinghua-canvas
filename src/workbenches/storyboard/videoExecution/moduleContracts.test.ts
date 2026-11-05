import { describe, expect, it, vi } from 'vitest'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../../domain/storyboard/storyboard'
import { createMemoryStorage } from '../../../platform/memory'
import {
  assetMimeOf,
  buildShotVideoPlan,
  humanError,
  parentRunIdOf,
  prepareShotVideo,
} from './materialPreparation'
import { loadMergedDocument, projectVideoResults } from './resultProjection'
import { executePlan } from './executionState'
import type { StoryboardCanvasNode } from '../../../features/storyboard/canvasPort'
import type { StoryboardRunPlan } from '../../../domain/storyboard/runTypes'

function docWithShot(): StoryboardDoc {
  let doc = emptyStoryboard('project-1', 1)
  doc = addEpisode(doc)
  doc = addShot(doc, doc.episodes[0]!.id)
  return {
    ...doc,
    shots: doc.shots.map((shot) => ({
      ...shot,
      nodeId: 'image-node',
      imageHash: 'image-hash',
      scene: '一只猫',
    })),
  }
}

const nodes: StoryboardCanvasNode[] = [
  {
    id: 'image-node',
    type: 'generation',
    x: 10,
    y: 20,
    w: 200,
    h: 200,
    parentId: null,
    data: { assetMime: 'image/webp' },
  } as StoryboardCanvasNode,
]

function successOutcome(plan: StoryboardRunPlan, hash = 'video-hash') {
  return {
    summary: {
      runPlanId: plan.id,
      mode: plan.mode,
      taskResults: plan.tasks.map((task) => ({
        taskId: task.id,
        nodeId: task.nodeId,
        state: {
          kind: 'succeeded',
          result: [
            { hash, mime: 'video/mp4', bytes: new Uint8Array([1]) },
          ],
          duration: 1,
        },
      })),
      succeeded: plan.tasks.length,
      failed: 0,
      canceled: 0,
      startedAt: 1,
      finishedAt: 2,
      records: [],
    },
    warnings: [],
    failures: [],
  }
}

describe('storyboard video execution / material preparation module', () => {
  it('reads asset mimes from storage with node metadata as fallback', async () => {
    const storage = createMemoryStorage({
      rows: {
        assets: [{ id: 'image-hash', bytes: new Uint8Array([1]), mime: 'image/avif' }],
      },
    })
    await expect(assetMimeOf({ storage }, 'image-hash', 'image/png')).resolves.toBe(
      'image/avif',
    )
    await expect(assetMimeOf({ storage }, undefined, 'video/mp4')).resolves.toBe(
      'video/mp4',
    )
    await expect(
      assetMimeOf({ storage: createMemoryStorage() }, 'missing', 'image/png'),
    ).resolves.toBe('image/png')
  })

  it('prepares a shot recipe and a zero-dependency plan with its real image MIME', async () => {
    const doc = docWithShot()
    const ports = {
      graphNodes: nodes,
      liveNodeIds: new Set(['image-node']),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'video-channel',
          model: 'video-model',
          params: {},
          substituted: false,
        }),
        getState: () => ({
          channels: [
            { id: 'video-channel', modelMap: {}, models: [], modelCache: [] },
          ],
        }),
      },
      storage: createMemoryStorage(),
      projectId: 'project-1',
    }
    const prepared = await prepareShotVideo(
      ports as never,
      doc.shots[0]!,
      doc,
    )
    expect(prepared).toMatchObject({
      channelId: 'video-channel',
      model: 'video-model',
      imageMime: 'image/webp',
      endFrameMime: 'image/png',
      includeEndFrame: false,
    })
    const plan = buildShotVideoPlan(doc, [prepared])
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.dependsOn).toEqual([])
    expect(plan.tasks[0]!.request.inputs).toEqual([
      expect.objectContaining({ assetHash: 'image-hash', mime: 'image/webp' }),
    ])
  })

  it('selects the newest allowed succeeded run record as postprocess parent', async () => {
    const doc = docWithShot()
    const storage = createMemoryStorage({
      rows: {
        runRecords: [
          {
            id: 'older',
            projectId: 'project-1',
            workbench: 'storyboard',
            subjectId: `shot:${doc.shots[0]!.id}`,
            status: 'succeeded',
            createdAt: 1,
            params: { action: 'shot-video' },
          },
          {
            id: 'newest',
            projectId: 'project-1',
            workbench: 'storyboard',
            subjectId: `shot:${doc.shots[0]!.id}`,
            status: 'succeeded',
            createdAt: 2,
            params: { action: 'video-edit' },
          },
        ],
      },
    })
    await expect(
      parentRunIdOf({ storage, projectId: 'project-1' }, doc.shots[0]!),
    ).resolves.toBe('newest')
    expect(humanError(new Error('bad request'))).toBe('bad request')
  })
})

describe('storyboard video execution / projection and execution state modules', () => {
  it('merges the latest document and projects only successful matching video assets', async () => {
    const doc = docWithShot()
    const produced: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) => ({ ...shot, videoHash: 'video-hash' })),
    }
    const createGenerationNode = vi.fn(() => 'video-node')
    const ports = {
      currentDoc: () => doc,
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'project-1',
      graphEdges: [],
      liveNodeIds: new Set(['image-node']),
      projection: {
        beginPlan: vi.fn(),
        endPlan: vi.fn(),
        createGenerationNode,
        updateNodeData: vi.fn(),
        connectEdge: vi.fn(),
        removeEdge: vi.fn(),
        resolveGenerationData: async (data: Record<string, unknown>) => data,
      },
    }
    const merged = await loadMergedDocument(ports as never)
    expect(merged.shots[0]!.videoHash).toBe('video-hash')
    const prepared = await prepareShotVideo(
      {
        graphNodes: nodes,
        liveNodeIds: ports.liveNodeIds,
        channels: {
          defaultForNewNode: async () => ({
            channelId: 'video-channel',
            model: 'video-model',
            params: {},
            substituted: false,
          }),
          getState: () => ({
            channels: [
              { id: 'video-channel', modelMap: {}, models: [], modelCache: [] },
            ],
          }),
        },
        storage: createMemoryStorage(),
      } as never,
      merged.shots[0]!,
      merged,
    )
    const plan = buildShotVideoPlan(merged, [prepared])
    const result = await projectVideoResults(
      ports as never,
      merged,
      plan,
      successOutcome(plan) as never,
      [prepared],
    )
    expect(createGenerationNode).toHaveBeenCalledTimes(1)
    expect(result.warnings).toEqual([])
    expect(result.document.shots[0]).toMatchObject({
      videoNodeId: 'video-node',
      videoHash: 'video-hash',
    })
  })

  it('clears the 20-minute cancellation timer after execution settles', async () => {
    vi.useFakeTimers()
    try {
      const plan = {
        id: 'plan-1',
        mode: 'sequential',
        tasks: [],
      } as unknown as StoryboardRunPlan
      const run = vi.fn(async () => ({
        summary: {
          runPlanId: plan.id,
          mode: plan.mode,
          taskResults: [],
          succeeded: 0,
          failed: 0,
          canceled: 0,
          startedAt: 1,
          finishedAt: 2,
          records: [],
        },
        warnings: [],
        failures: [],
      }))
      const ports = {
        execution: { run, cancel: vi.fn() },
        flush: async () => {},
      }
      await executePlan(ports as never, plan)
      expect(run).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
