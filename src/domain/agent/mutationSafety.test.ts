import { describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../canvas/model/graph'
import type { NodeSnapshot } from '../canvas/model/node'
import {
  normalizeCanvasBatchSteps,
  prepareMutationCall,
  verifyMutationPrecondition,
} from './mutationSafety'

function node(id: string, title = id): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type: 'prompt',
    title,
    disabled: false,
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    data: { text: `正文-${id}`, upstreamPromptLinked: false },
  }
}

function graph(nodes = [node('a'), node('b')]): GraphSnapshot {
  return {
    projectId: 'p1',
    nodes,
    edges: [
      {
        id: 'e1',
        projectId: 'p1',
        source: 'a',
        target: 'b',
        sourcePort: 'output',
        targetPort: 'input',
      },
    ],
  }
}

describe('Agent mutation safety', () => {
  it('给目标节点附隐藏前置条件，无关节点变化不拦', () => {
    const before = graph()
    const prepared = prepareMutationCall({
      name: 'renameNode',
      args: { nodeId: 'a', title: '新标题' },
      graph: before,
      revision: 3,
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    const unrelatedChanged: GraphSnapshot = {
      ...before,
      nodes: before.nodes.map((item) =>
        item.id === 'b' ? { ...item, title: '用户刚改了另一个' } : item,
      ),
    }
    expect(verifyMutationPrecondition(prepared.args, unrelatedChanged)).toEqual([])

    const targetChanged: GraphSnapshot = {
      ...before,
      nodes: before.nodes.map((item) =>
        item.id === 'a' ? { ...item, title: '用户自己改了' } : item,
      ),
    }
    expect(verifyMutationPrecondition(prepared.args, targetChanged)).toEqual([
      '节点「用户自己改了」在确认后发生了变化，请重新读取后再操作',
    ])
  })

  it('目标已删除时在执行前报人话', () => {
    const prepared = prepareMutationCall({
      name: 'deleteNodes',
      args: { nodeIds: ['a'] },
      graph: graph(),
      revision: 1,
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(verifyMutationPrecondition(prepared.args, graph([node('b')]))[0]).toContain(
      '已被删除或替换',
    )
  })

  it('批量步骤只接受有边界的已有节点操作', () => {
    expect(normalizeCanvasBatchSteps([]).ok).toBe(false)
    expect(
      normalizeCanvasBatchSteps([
        { op: 'rename', nodeId: 'a', title: '标题' },
        { op: 'move', nodeIds: ['a', 'b'], dx: 20, dy: -10 },
        { op: 'deleteEdges', edgeIds: ['e1'] },
      ]),
    ).toMatchObject({ ok: true, steps: expect.any(Array) })
    expect(normalizeCanvasBatchSteps([{ op: 'unknown' }]).ok).toBe(false)
    expect(
      normalizeCanvasBatchSteps([{ op: 'move', nodeIds: ['a'], dx: 0, dy: 0 }]).ok,
    ).toBe(false)
  })

  it('批量预检会同时锁住节点与连线', () => {
    const prepared = prepareMutationCall({
      name: 'applyCanvasBatch',
      args: {
        steps: [
          { op: 'rename', nodeId: 'a', title: '标题' },
          { op: 'deleteEdges', edgeIds: ['e1'] },
        ],
      },
      graph: graph(),
      revision: 2,
    })
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(verifyMutationPrecondition(prepared.args, graph())).toEqual([])
    const changed: GraphSnapshot = {
      ...graph(),
      edges: [{ ...graph().edges[0]!, target: 'a' }],
    }
    expect(verifyMutationPrecondition(prepared.args, changed)).toEqual([
      '连线「e1」在确认后发生了变化，请重新读取后再操作',
    ])
  })
})
