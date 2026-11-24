import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory'
import { registerAllSpecs, resetSpecs } from '../../../domain/canvas/nodeSpecs'
import { createCanvasStore } from '../../../state/workbenches/canvas/store'
import { applyCanvasBatchInStore } from './agentBatchMutationTools'

const platform = createMemoryPlatform()

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

function setup() {
  const store = createCanvasStore({ platform, projectId: 'p1' })
  store.dispatch({ kind: 'node.create', id: 'a', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 }, title: 'A' })
  store.dispatch({ kind: 'node.create', id: 'b', projectId: 'p1', type: 'prompt', at: { x: 400, y: 0 }, title: 'B' })
  store.dispatch({ kind: 'edge.connect', source: 'a', target: 'b' })
  return store
}

describe('Agent applyCanvasBatch', () => {
  it('★★ 多项操作一次提交，并可用一次 Undo 全部撤销', async () => {
    const store = setup()
    const before = store.getSnapshot()
    const edgeId = before.edges[0]!.id
    const result = await applyCanvasBatchInStore(store, {
      steps: [
        { op: 'rename', nodeId: 'a', title: '新版主图' },
        { op: 'move', nodeIds: ['a'], dx: 50, dy: 30 },
        { op: 'deleteEdges', edgeIds: [edgeId] },
      ],
    })
    expect(result).toMatchObject({ ok: true, appliedSteps: 3 })
    expect(store.getSnapshot().nodes.find((node) => node.id === 'a')).toMatchObject({
      title: '新版主图',
      x: 50,
      y: 30,
    })
    expect(store.getSnapshot().edges).toHaveLength(0)

    store.undo()
    expect(store.getSnapshot()).toEqual(before)
  })

  it('任意一步预检失败时一个节点都不改', async () => {
    const store = setup()
    const before = store.getSnapshot()
    const result = await applyCanvasBatchInStore(store, {
      steps: [
        { op: 'rename', nodeId: 'a', title: '会成功' },
        { op: 'deleteNodes', nodeIds: ['missing'] },
      ],
    })
    expect(result.ok).toBe(false)
    expect(store.getSnapshot()).toEqual(before)
  })

  it('禁止后续步骤操作前面已经删除的节点', async () => {
    const store = setup()
    const before = store.getSnapshot()
    const result = await applyCanvasBatchInStore(store, {
      steps: [
        { op: 'deleteNodes', nodeIds: ['a'] },
        { op: 'rename', nodeId: 'a', title: '复活' },
      ],
    })
    expect(result).toMatchObject({ ok: false })
    expect(store.getSnapshot()).toEqual(before)
  })
})
