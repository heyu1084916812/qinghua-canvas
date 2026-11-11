import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore } from '../../../state/workbenches/canvas/store'
import { buildRunPlan } from './buildRunPlan'
import { createCanvasPlacement } from './canvasPlacement'
import { batchSpec } from '../../../domain/canvas/nodeSpecs/batch'

describe('canvas placement carrier provenance', () => {
  beforeEach(() => {
    registerAllSpecs()
  })

  it('marks a newly created carrier from a normal generation rerun', () => {
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    const nodeId = 'gen-source'
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 0, y: 0 },
      id: nodeId,
      data: {
        ...generationSpec.createDefaultData(),
        prompt: 'rerun this image',
        channelId: 'channel-1',
        model: 'image-1',
        assetHash: 'source-hash',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })

    const plan = buildRunPlan('node', { originNodeId: nodeId }, store.getSnapshot(), 'single')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]?.slot.kind).toBe('new')

    const placement = createCanvasPlacement(() => 'p1')
    const began = placement.begin(plan.tasks[0]!, {
      isRepeat: false,
      slotIndex: 0,
      slotCount: 1,
    })
    const create = began.commands.find((command) => command.kind === 'node.create')

    expect(create?.kind).toBe('node.create')
    if (create?.kind !== 'node.create') throw new Error('expected node.create')
    expect((create.data as Record<string, unknown>).__carrierOf).toBe(nodeId)
    expect((create.data as Record<string, unknown>).prompt).toBe('rerun this image')
  })

  it('does not mark reused source nodes as their own carriers', () => {
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    const nodeId = 'gen-empty'
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 0, y: 0 },
      id: nodeId,
      data: {
        ...generationSpec.createDefaultData(),
        prompt: 'first image',
        channelId: 'channel-1',
        model: 'image-1',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })

    const plan = buildRunPlan('node', { originNodeId: nodeId }, store.getSnapshot(), 'single')
    expect(plan.tasks[0]?.slot).toEqual({ kind: 'reuse', nodeId })

    const placement = createCanvasPlacement(() => 'p1')
    const began = placement.begin(plan.tasks[0]!, {
      isRepeat: false,
      slotIndex: 0,
      slotCount: 1,
    })

    expect(began.targetId).toBe(nodeId)
    expect(began.commands).toEqual([])
  })

  it('projects a batch item result back to the child as a preview without replacing its input', () => {
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 0, y: 0 },
      id: 'item-1',
      parentId: 'batch-1',
      data: {
        ...generationSpec.createDefaultData(),
        assetHash: 'input-hash',
      },
    })
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'batch',
      at: { x: 100, y: 0 },
      id: 'batch-1',
      data: {
        ...batchSpec.createDefaultData(),
        channelId: 'channel-1',
        model: 'image-1',
        prompt: '统一要求',
        childIds: ['item-1'],
        contentType: 'media',
      },
    })

    const plan = buildRunPlan('node', { originNodeId: 'batch-1' }, store.getSnapshot(), 'single')
    const task = plan.tasks[0]!
    expect(task).toMatchObject({
      nodeId: 'batch-1',
      collectionItemId: 'item-1',
      collectionItemType: 'generation',
    })

    const placement = createCanvasPlacement(() => 'p1')
    const commands = placement.commit(task, 'carrier-1', [{
      hash: 'output-hash',
      mime: 'image/png',
      bytes: new Uint8Array([1]),
      width: 64,
      height: 64,
    }])
    const projection = commands.find(
      (command) => command.kind === 'node.updateData' && command.id === 'item-1',
    )
    const batchProjection = commands.find(
      (command) => command.kind === 'node.updateData' && command.id === 'batch-1',
    )

    expect(projection).toMatchObject({
      patch: {
        batchResultHash: 'output-hash',
        lastRunPrompt: '统一要求',
      },
      transient: true,
    })
    const carrierUpdate = commands.find(
      (command) => command.kind === 'node.updateData' && command.id === 'carrier-1',
    )
    expect(carrierUpdate).toMatchObject({
      patch: {
        prompt: '统一要求',
        lastRunPrompt: '统一要求',
      },
    })
    expect(batchProjection).toMatchObject({
      patch: { batchResultHashes: ['output-hash'] },
      transient: true,
    })
    expect((projection as { patch: Record<string, unknown> }).patch).not.toHaveProperty('assetHash')
  })
})
