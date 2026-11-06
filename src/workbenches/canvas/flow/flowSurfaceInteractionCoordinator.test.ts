import { describe, expect, it, vi } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import {
  importSurfaceFiles,
  planChildPointerDown,
  planSurfaceClick,
  planSurfaceContextMenu,
  planSurfacePointerDown,
} from './flowSurfaceInteractionCoordinator'

function node(id: string, parentId: string | null = null): NodeSnapshot {
  return {
    id,
    projectId: 'project',
    parentId,
    type: 'prompt',
    x: 0,
    y: 0,
    w: 100,
    h: 80,
    title: id,
    disabled: false,
  } as NodeSnapshot
}

const snapshot: GraphSnapshot = {
  projectId: 'project',
  nodes: [node('top'), node('child', 'parent'), node('parent')],
  edges: [],
}

describe('FlowSurface interaction coordinator', () => {
  it('treats a drag release as no click and only clears blank-canvas selection', () => {
    expect(
      planSurfaceClick({
        press: { x: 0, y: 0 },
        release: { x: 20, y: 0 },
        nodeId: null,
        parentId: null,
        floatingTarget: false,
        selection: ['top'],
        shiftKey: false,
      }),
    ).toEqual({ kind: 'none' })
    expect(
      planSurfaceClick({
        press: { x: 0, y: 0 },
        release: { x: 1, y: 0 },
        nodeId: null,
        parentId: null,
        floatingTarget: false,
        selection: ['top'],
        shiftKey: false,
      }),
    ).toEqual({ kind: 'clear', selection: [] })
    expect(
      planSurfaceClick({
        press: { x: 0, y: 0 },
        release: { x: 1, y: 0 },
        nodeId: null,
        parentId: null,
        floatingTarget: true,
        selection: ['top'],
        shiftKey: false,
      }),
    ).toEqual({ kind: 'none' })
  })

  it('routes child clicks through the existing parent-removal selection rule', () => {
    expect(
      planSurfaceClick({
        press: null,
        release: { x: 0, y: 0 },
        nodeId: 'child',
        parentId: 'parent',
        floatingTarget: false,
        selection: ['parent'],
        shiftKey: true,
      }),
    ).toEqual({ kind: 'select', selection: ['child'] })
  })

  it('ordinary child pointerdown preserves multi-selection and starts drag', () => {
    expect(
      planChildPointerDown({
        selection: ['a', 'child'],
        childId: 'child',
        shiftKey: false,
        batchSlot: { parentId: 'batch', at: { x: 10, y: 20 } },
      }),
    ).toEqual({
      selection: null,
      reparent: { parentId: 'batch', at: { x: 10, y: 20 } },
      beginDrag: true,
    })
  })

  it('Shift child pointerdown only toggles selection and never drags or reparents', () => {
    expect(
      planChildPointerDown({
        selection: ['a', 'child'],
        childId: 'child',
        shiftKey: true,
        batchSlot: { parentId: 'batch', at: { x: 10, y: 20 } },
      }),
    ).toEqual({
      selection: ['a'],
      reparent: null,
      beginDrag: false,
    })
  })

  it('plans pan before node handling and duplicate before RF drag', () => {
    const nodeRects = vi.fn(() => new Map([['top', { x: 20, y: 30 }]]))
    const base = {
      nodeId: 'top',
      selection: ['top'],
      graph: snapshot,
      viewport: { x: 0, y: 0, zoom: 1 },
      surface: { left: 10, top: 20, width: 800, height: 600 },
      nodeRects,
      clientX: 50,
      clientY: 60,
    }
    expect(planSurfacePointerDown({ ...base, button: 0, spaceHeld: true, altKey: false })).toEqual({
      kind: 'pan',
    })
    expect(nodeRects).not.toHaveBeenCalled()
    expect(planSurfacePointerDown({ ...base, button: 0, spaceHeld: false, altKey: true })).toEqual({
      kind: 'duplicate',
      nodeId: 'top',
      dismissPanel: true,
    })
    expect(nodeRects).not.toHaveBeenCalled()
  })

  it('anchors every selected top-level node from DOM rectangles', () => {
    const graph = {
      ...snapshot,
      nodes: [node('a'), node('b')],
    }
    const plan = planSurfacePointerDown({
      button: 0,
      spaceHeld: false,
      altKey: false,
      nodeId: 'a',
      selection: ['a', 'b'],
      graph,
      viewport: { x: 10, y: 20, zoom: 2 },
      surface: { left: 10, top: 20, width: 800, height: 600 },
      nodeRects: () => new Map([
        ['a', { x: 30, y: 40 }],
        ['b', { x: 50, y: 60 }],
      ]),
      clientX: 100,
      clientY: 100,
    })
    expect(plan.kind).toBe('anchor')
    if (plan.kind === 'anchor') {
      expect(plan.anchor.nodes.get('a')).toEqual({ x: 20, y: 30 })
      expect(plan.anchor.nodes.get('b')).toEqual({ x: 30, y: 40 })
    }
  })

  it('opens context menus in surface-local coordinates and selects unselected nodes', () => {
    expect(
      planSurfaceContextMenu({
        clientX: 120,
        clientY: 80,
        surface: { left: 20, top: 30 },
        nodeId: 'top',
        selection: [],
      }),
    ).toEqual({
      menu: { x: 100, y: 50, target: { kind: 'node', nodeId: 'top' } },
      selection: ['top'],
    })
  })

  it('imports, reports rejected files, selects new ids and shows undo feedback', async () => {
    const ports = {
      importFiles: vi.fn(async () => ({ ids: ['a'], rejected: 1 })),
      select: vi.fn(),
      notify: vi.fn(),
      showUndoBar: vi.fn(),
    }
    await importSurfaceFiles([new File(['x'], 'a.png')], { x: 1, y: 2 }, ports)
    expect(ports.select).toHaveBeenCalledWith(['a'])
    expect(ports.notify).toHaveBeenCalledOnce()
    expect(ports.showUndoBar).toHaveBeenCalledWith(
      '跳过 1 个文件：只支持图片 / 视频素材',
    )
  })
})
