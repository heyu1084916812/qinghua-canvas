import { describe, expect, it, vi } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import {
  applyFlowDeleteKey,
  applyFlowEdgeChanges,
  applyFlowNodeChanges,
  beginFlowNodeDrag,
  beginSelectionMarquee,
  finishFlowNodeDrag,
  flowEdgeIdsOf,
  flowNodeIdsOf,
  routeFlowNodeEvent,
  scheduleFlowNodeMeasurement,
  selectionFromMarquee,
} from './flowSurfaceFlowActionCoordinator'
import type { FlowDeletePorts } from './flowSurfaceChangeCoordinator'

function node(id: string, x: number, y: number): NodeSnapshot {
  return {
    id,
    projectId: 'project',
    parentId: null,
    type: 'prompt',
    x,
    y,
    w: 100,
    h: 80,
    title: id,
    disabled: false,
  } as NodeSnapshot
}

function snapshot(nodes = [node('a', 0, 0), node('b', 200, 0)]): GraphSnapshot {
  return { projectId: 'project', nodes, edges: [] }
}

function deletePorts(): FlowDeletePorts {
  return {
    removeEdge: vi.fn(),
    deleteNodes: vi.fn(),
    clearSelection: vi.fn(),
    showUndoBar: vi.fn(),
  }
}

describe('FlowSurface flow action coordinator', () => {
  it('applies selection changes and node moves with the existing decision plans', () => {
    const ports = {
      setSelection: vi.fn(),
      stampNodeSelection: vi.fn(),
      setSnapHints: vi.fn(),
      markDragMoved: vi.fn(),
      moveNodes: vi.fn(),
    }
    applyFlowNodeChanges(
      {
        graph: snapshot(),
        selection: [],
        changes: [
          { type: 'select', id: 'a', selected: true },
          { type: 'position', id: 'a', position: { x: 4, y: 6 } },
        ],
        marquee: null,
        baseline: [],
        anchor: null,
      },
      ports,
    )
    expect(ports.setSelection).toHaveBeenCalledWith(['a'])
    expect(ports.stampNodeSelection).toHaveBeenCalledOnce()
    expect(ports.moveNodes).toHaveBeenCalledWith(['a'], 4, 6, 'move')
    expect(ports.markDragMoved).toHaveBeenCalledWith(true)
  })

  it('keeps begin, final alignment, end, release and reparent order', () => {
    const calls: string[] = []
    beginFlowNodeDrag(
      { mainId: 'a', draggedIds: ['a'] },
      {
        markDragMoved: (value) => calls.push(`moved:${value}`),
        setDragging: (active, id) => calls.push(`dragging:${active}:${id}`),
        moveNodes: (ids, dx, dy, phase) =>
          calls.push(`move:${ids.join(',')}:${dx}:${dy}:${phase}`),
      },
    )
    finishFlowNodeDrag(
      {
        mainId: 'a',
        draggedIds: ['a'],
        moved: true,
        anchor: null,
        pointer: null,
        pointerWorld: () => {
          calls.push('pointerWorld')
          return null
        },
      },
      {
        getSnapshot: () => snapshot(),
        resetDragTracking: () => calls.push('reset'),
        moveNodes: (ids, dx, dy, phase) =>
          calls.push(`move:${ids.join(',')}:${dx}:${dy}:${phase}`),
        setDragging: (active) => calls.push(`dragging:${active}`),
        setSnapHints: () => calls.push('snap'),
        setPanelDismissed: (value) => calls.push(`dismissed:${value}`),
        notify: vi.fn(),
        reparent: vi.fn(),
      },
    )
    expect(calls).toEqual([
      'moved:false',
      'dragging:true:a',
      'move:a:0:0:begin',
      'reset',
      'move:a:0:0:end',
      'dragging:false',
      'snap',
      'dismissed:true',
      'pointerWorld',
    ])
  })

  it('uses the same edge same/stamp suppression and returns false for editable delete', () => {
    const setEdgeSelection = vi.fn()
    applyFlowEdgeChanges(
      {
        changes: [{ type: 'select', id: 'e2', selected: true }],
        nodeSelectStamp: true,
      },
      { getEdgeSelection: () => ['e1'], setEdgeSelection },
    )
    expect(setEdgeSelection).not.toHaveBeenCalled()

    expect(
      applyFlowDeleteKey(
        {
          key: 'Delete',
          target: { tagName: 'INPUT' },
          nodeIds: ['a'],
          edgeIds: [],
        },
        deletePorts(),
      ),
    ).toBe(false)
  })

  it('routes run, cancel and ordinary node events separately', () => {
    const ports = { run: vi.fn(), cancel: vi.fn(), emit: vi.fn() }
    routeFlowNodeEvent('a', { type: 'requestRun' } as never, ports)
    routeFlowNodeEvent('a', { type: 'requestRunCancel' } as never, ports)
    routeFlowNodeEvent('a', { type: 'open' } as never, ports)
    expect(ports.run).toHaveBeenCalledWith('a')
    expect(ports.cancel).toHaveBeenCalledWith('a')
    expect(ports.emit).toHaveBeenCalledWith('a', { type: 'open' })
  })

  it('builds marquee sessions and filters against current graph geometry', () => {
    const session = beginSelectionMarquee({
      point: { x: 0, y: 0 },
      selection: ['old'],
      shiftKey: true,
    })
    expect(session.baseline).toEqual(['old'])
    expect(
      selectionFromMarquee({
        graph: snapshot(),
        marquee: { x: 0, y: 0, w: 120, h: 100 },
        baseline: session.baseline,
      }),
    ).toEqual(['old', 'a'])
  })

  it('schedules double-frame measurement and cancels pending work', () => {
    const frames: Array<() => void> = []
    const timers: Array<() => void> = []
    const cancelFrame = vi.fn()
    const cancelSchedule = vi.fn()
    const updateNodeInternals = vi.fn()
    const cleanup = scheduleFlowNodeMeasurement(snapshot(), {
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame,
      schedule: (callback, delayMs) => {
        expect(delayMs).toBe(120)
        timers.push(callback)
        return timers.length
      },
      cancelSchedule,
      updateNodeInternals,
    })
    frames[0]()
    frames[1]()
    timers[0]()
    expect(updateNodeInternals).toHaveBeenCalledWith(['a', 'b'])
    cleanup()
    expect(cancelFrame).toHaveBeenCalled()
    expect(cancelSchedule).toHaveBeenCalledWith(1)
  })

  it('maps React Flow ids without changing order', () => {
    expect(flowNodeIdsOf([{ id: 'a' }, { id: 'b' }] as never)).toEqual(['a', 'b'])
    expect(flowEdgeIdsOf([{ id: 'e1' }, { id: 'e2' }] as never)).toEqual(['e1', 'e2'])
  })
})
