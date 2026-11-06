import { describe, expect, it, vi } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'
import {
  deleteFlowEdgeIds,
  deleteFlowNodeIds,
  dragIdsOf,
  executeFlowDeletion,
  planChildNodeSelection,
  planEdgeSelection,
  planFlowDeleteKey,
  planFlowDragEnd,
  planFlowDragDrop,
  planNodePositionChanges,
  planNodeSelection,
  type FlowDeletePorts,
  type FlowDragAnchor,
} from './flowSurfaceChangeCoordinator'

function node(
  id: string,
  x: number,
  y: number,
  options: {
    parentId?: string | null
    w?: number
    h?: number
    type?: NodeType
  } = {},
): NodeSnapshot {
  return {
    id,
    projectId: 'project',
    type: options.type ?? 'prompt',
    parentId: options.parentId ?? null,
    x,
    y,
    w: options.w ?? 100,
    h: options.h ?? 80,
    title: id,
    disabled: false,
  } as NodeSnapshot
}

function graph(nodes: NodeSnapshot[]): GraphSnapshot {
  return { projectId: 'project', nodes, edges: [] }
}

function anchor(
  nodes: Record<string, { x: number; y: number }>,
  clientX = 0,
  clientY = 0,
  zoom = 1,
): FlowDragAnchor {
  return {
    clientX,
    clientY,
    zoom,
    nodes: new Map(Object.entries(nodes)),
  }
}

function ports() {
  const calls: string[] = []
  const value: FlowDeletePorts = {
    removeEdge: vi.fn((id: string) => calls.push(`edge:${id}`)),
    deleteNodes: vi.fn((ids: readonly string[]) => calls.push(`nodes:${ids.join(',')}`)),
    clearSelection: vi.fn(() => calls.push('clear')),
    showUndoBar: vi.fn((message: string) => calls.push(`undo:${message}`)),
  }
  return { calls, value }
}

describe('FlowSurface 节点/连线变更协调器', () => {
  it('节点选择以顶层 RF 节点为 baseline，并合并增删', () => {
    const snapshot = graph([
      node('top-1', 0, 0),
      node('top-2', 300, 0, { type: 'group' }),
      node('child', 0, 0, { parentId: 'top-2' }),
    ])
    const plan = planNodeSelection({
      graph: snapshot,
      selection: ['top-2', 'child'],
      changes: [
        { type: 'select', id: 'top-1', selected: true },
        { type: 'select', id: 'top-2', selected: false },
      ],
      marquee: null,
      baseline: [],
    })
    expect(plan).toEqual({ selection: ['top-1'], changed: true })
  })

  it('框选未命中的节点选择不加入，全部过滤时不算改变', () => {
    const snapshot = graph([
      node('inside', 10, 10),
      node('outside', 500, 500),
    ])
    const marquee = { x: 0, y: 0, w: 150, h: 150 }
    const filtered = planNodeSelection({
      graph: snapshot,
      selection: [],
      changes: [{ type: 'select', id: 'outside', selected: true }],
      marquee,
      baseline: [],
    })
    expect(filtered).toEqual({ selection: [], changed: false })

    const mixed = planNodeSelection({
      graph: snapshot,
      selection: [],
      changes: [
        { type: 'select', id: 'outside', selected: true },
        { type: 'select', id: 'inside', selected: true },
      ],
      marquee,
      baseline: [],
    })
    expect(mixed).toEqual({ selection: ['inside'], changed: true })
  })

  it('位置增量始终取第一个 position change 与 store 快照', () => {
    const snapshot = graph([node('n1', 10, 20), node('n2', 30, 40)])
    const plan = planNodePositionChanges({
      graph: snapshot,
      changes: [
        { type: 'position', id: 'n2', position: { x: 37, y: 46 } },
        { type: 'position', id: 'n1', position: { x: 99, y: 99 } },
      ],
      anchor: null,
    })
    expect(plan).toEqual({
      move: {
        ids: ['n2', 'n1'],
        dx: 7,
        dy: 6,
      },
      snapHints: null,
      snapHintsChanged: false,
    })
  })

  it('零位移不下发 move，有锚点时把吸附修正并入同一帧', () => {
    const snapshot = graph([node('n1', 0, 0), node('other', 8, 0)])
    const zero = planNodePositionChanges({
      graph: snapshot,
      changes: [{ type: 'position', id: 'n1', position: { x: 0, y: 0 } }],
      anchor: null,
    })
    expect(zero?.move).toBeNull()

    const snapped = planNodePositionChanges({
      graph: snapshot,
      changes: [{ type: 'position', id: 'n1', position: { x: 2, y: 0 } }],
      anchor: anchor({ n1: { x: 0, y: 0 } }),
    })
    expect(snapped?.move).toEqual({ ids: ['n1'], dx: 8, dy: 0 })
    expect(snapped?.snapHintsChanged).toBe(true)
    expect(snapped?.snapHints).not.toBeNull()
  })

  it('边选择先判 same，再受 nodeSelectStamp 抑制', () => {
    expect(
      planEdgeSelection({
        current: ['e1'],
        changes: [{ type: 'select', id: 'e1', selected: true }],
        nodeSelectStamp: true,
      }),
    ).toEqual({ kind: 'same' })

    expect(
      planEdgeSelection({
        current: ['e1'],
        changes: [{ type: 'select', id: 'e2', selected: true }],
        nodeSelectStamp: true,
      }),
    ).toEqual({ kind: 'suppressed' })

    expect(
      planEdgeSelection({
        current: ['e1'],
        changes: [{ type: 'select', id: 'e2', selected: true }],
        nodeSelectStamp: false,
      }),
    ).toEqual({ kind: 'apply', ids: ['e1', 'e2'] })
  })

  it('Delete / Backspace 在可编辑目标与空选择上 no-op', () => {
    expect(
      planFlowDeleteKey({
        key: 'Delete',
        target: { tagName: 'INPUT' },
        nodeIds: ['n1'],
        edgeIds: ['e1'],
      }),
    ).toBeNull()
    expect(
      planFlowDeleteKey({
        key: 'Backspace',
        target: { isContentEditable: true },
        nodeIds: ['n1'],
        edgeIds: [],
      }),
    ).toBeNull()
    expect(
      planFlowDeleteKey({
        key: 'Backspace',
        target: { tagName: 'DIV' },
        nodeIds: [],
        edgeIds: [],
      }),
    ).toBeNull()
  })

  it('删除计划按 edge、node、清选、撤销条严格排序', () => {
    const spies = ports()
    const plan = planFlowDeleteKey({
      key: 'Delete',
      target: { tagName: 'DIV' },
      nodeIds: ['n1'],
      edgeIds: ['e1', 'e2'],
    })
    executeFlowDeletion(plan, spies.value)
    expect(spies.calls).toEqual([
      'edge:e1',
      'edge:e2',
      'nodes:n1',
      'clear',
      'undo:已删除节点',
    ])
  })

  it('节点 / 连线空删除不调用任何端口', () => {
    const spies = ports()
    deleteFlowNodeIds([], spies.value)
    deleteFlowEdgeIds([], spies.value)
    executeFlowDeletion(null, spies.value)
    expect(spies.value.removeEdge).not.toHaveBeenCalled()
    expect(spies.value.deleteNodes).not.toHaveBeenCalled()
    expect(spies.value.clearSelection).not.toHaveBeenCalled()
    expect(spies.value.showUndoBar).not.toHaveBeenCalled()
  })

  it('子节点点击只摘除父容器并保持 Shift 增删语义', () => {
    expect(
      planChildNodeSelection({
        selection: ['parent', 'child'],
        childId: 'child',
        parentId: 'parent',
        shiftKey: true,
      }),
    ).toEqual({ selection: ['child'], changed: true })
    expect(
      planChildNodeSelection({
        selection: ['other'],
        childId: 'child',
        parentId: 'parent',
        shiftKey: true,
      }),
    ).toEqual({ selection: ['other', 'child'], changed: true })
  })

  it('松手计划先补终点位移，再从同一锚点计算终点吸附', () => {
    const snapshot = graph([node('n1', 12, 0), node('other', 24, 0)])
    const plan = planFlowDragEnd({
      graph: snapshot,
      ids: ['n1'],
      moved: false,
      anchor: anchor({ n1: { x: 10, y: 0 } }, 0, 0, 1),
      pointer: { clientX: 10, clientY: 0 },
    })
    expect(plan.moves).toEqual([{ ids: ['n1'], dx: 8, dy: 0 }])
    expect(plan.snapMove).toEqual({ ids: ['n1'], dx: 4, dy: 0 })
    expect(plan.moved).toBe(true)
  })

  it('单节点松手才做归属判定，并复用现有落点规则', () => {
    const snapshot = graph([node('n1', 0, 0), node('group', 50, 0, { type: 'group' })])
    expect(
      planFlowDragDrop({
        graph: snapshot,
        ids: ['n1', 'group'],
        pointerWorld: { x: 60, y: 20 },
      }),
    ).toEqual({ kind: 'skip' })
    expect(
      planFlowDragDrop({
        graph: snapshot,
        ids: ['n1'],
        pointerWorld: { x: 60, y: 20 },
      }),
    ).not.toEqual({ kind: 'skip' })
  })

  it('拖拽 id 回落到主节点', () => {
    expect(dragIdsOf('n1', [])).toEqual(['n1'])
    expect(dragIdsOf('n1', ['n2', 'n3'])).toEqual(['n2', 'n3'])
  })
})
