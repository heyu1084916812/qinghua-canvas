import { describe, expect, it, vi } from 'vitest'
import type { AnnotateOp, AnnotateTextItem } from '../annotate/annotateOps'
import {
  createLightboxAnnotationActions,
  lightboxAnnotationPointOf,
  type LightboxAnnotationCanvas,
  type LightboxAnnotationPointer,
  type LightboxAnnotationPorts,
  type LightboxAnnotationState,
  type LightboxPointerDragHandlers,
} from './lightboxAnnotationCoordinator'

const canvas: LightboxAnnotationCanvas = {
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  pixelWidth: 200,
  pixelHeight: 100,
}

const textItem = (id: string, overrides: Partial<AnnotateTextItem> = {}): AnnotateTextItem => ({
  id,
  x: 20,
  y: 30,
  text: id,
  color: '#ffffff',
  fontSize: 20,
  ...overrides,
})

function pointer(overrides: Partial<LightboxAnnotationPointer> = {}): LightboxAnnotationPointer {
  return {
    button: 0,
    clientX: 60,
    clientY: 45,
    pointerId: 7,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    ...overrides,
  }
}

function harness(overrides: Partial<LightboxAnnotationState> = {}) {
  const state: LightboxAnnotationState = {
    tool: 'brush',
    color: '#ff0000',
    size: 4,
    ops: [],
    textItems: [],
    selectedTextId: null,
    editingTextId: null,
    undone: [],
    viewport: { zoom: 1 },
    natural: { w: 200, h: 100 },
    annotating: true,
    saving: false,
    ...overrides,
  }
  let drawing: AnnotateOp | null = null
  let sequence = 0
  let dragHandlers: LightboxPointerDragHandlers | null = null
  let dragCleanupCount = 0
  const capturePointer = vi.fn()
  const scheduleTextEditing = vi.fn()
  const saveAnnotation = vi.fn(async () => 'saved-node')
  const selectNode = vi.fn()
  const close = vi.fn()
  let nodeExists = true
  const hasNode = vi.fn(() => nodeExists)
  const subscribePointerDrag = vi.fn((handlers: LightboxPointerDragHandlers) => {
    dragHandlers = handlers
    return () => {
      dragCleanupCount += 1
    }
  })
  const ports: LightboxAnnotationPorts = {
    state: () => state,
    getDrawing: () => drawing,
    setDrawing: (next) => {
      drawing = next
    },
    setTextItems: (update) => {
      state.textItems = update([...state.textItems])
    },
    setSelectedTextId: (update) => {
      state.selectedTextId = update(state.selectedTextId)
    },
    setEditingTextId: (update) => {
      state.editingTextId = update(state.editingTextId)
    },
    setOps: (update) => {
      state.ops = update([...state.ops])
    },
    setUndone: (update) => {
      state.undone = update([...state.undone])
    },
    setTool: (tool) => {
      state.tool = tool
    },
    setSaving: (saving) => {
      state.saving = saving
    },
    capturePointer,
    scheduleTextEditing,
    createTextId: () => `text-${++sequence}`,
    subscribePointerDrag,
    hasNode,
    saveAnnotation,
    selectNode,
    close,
  }
  return {
    actions: createLightboxAnnotationActions(ports),
    state: () => state,
    drawing: () => drawing,
    capturePointer,
    scheduleTextEditing,
    saveAnnotation,
    selectNode,
    close,
    setNodeExists: (value: boolean) => {
      nodeExists = value
    },
    subscribePointerDrag,
    dragHandlers: () => dragHandlers,
    dragCleanupCount: () => dragCleanupCount,
  }
}

describe('lightboxAnnotationCoordinator', () => {
  it('maps screen coordinates to image pixels and records brush points', () => {
    expect(lightboxAnnotationPointOf(60, 45, canvas)).toEqual({ x: 100, y: 50 })
    const test = harness()
    const down = pointer()

    test.actions.pointerDown(down, canvas, () => undefined)
    test.actions.pointerMove(pointer({ clientX: 85, clientY: 70 }), canvas, () => undefined)

    expect(down.stopPropagation).toHaveBeenCalledOnce()
    expect(test.capturePointer).toHaveBeenCalledWith(7)
    expect(test.drawing()).toMatchObject({
      tool: 'brush',
      color: '#ff0000',
      size: 4,
      points: [
        { x: 100, y: 50 },
        { x: 150, y: 100 },
      ],
    })

    test.actions.pointerUp(() => undefined)
    expect(test.state().ops).toHaveLength(1)
    expect(test.state().undone).toEqual([])
  })

  it('drops rectangles smaller than three pixels on both axes', () => {
    const redraw = vi.fn()
    const test = harness({ tool: 'rect' })

    test.actions.pointerDown(pointer(), canvas, redraw)
    test.actions.pointerMove(pointer({ clientX: 61, clientY: 46 }), canvas, redraw)
    test.actions.pointerUp(redraw)

    expect(test.drawing()).toBeNull()
    expect(test.state().ops).toEqual([])
    expect(redraw).toHaveBeenCalledTimes(3)
  })

  it('creates, selects to the top, patches, and deletes text layers', () => {
    const first = textItem('a')
    const second = textItem('b')
    const test = harness({
      tool: 'text',
      size: 6,
      textItems: [first, second],
      selectedTextId: 'b',
      editingTextId: 'b',
    })

    test.actions.pointerDown(pointer(), canvas, () => undefined)
    expect(test.state().textItems).toHaveLength(3)
    expect(test.state().textItems[2]).toEqual({
      id: 'text-1',
      x: 100,
      y: 50,
      text: '',
      color: '#ff0000',
      fontSize: 30,
    })
    expect(test.state().selectedTextId).toBe('text-1')
    expect(test.scheduleTextEditing).toHaveBeenCalledWith('text-1')

    test.actions.selectTextItem('a')
    expect(test.state().textItems.map((item) => item.id)).toEqual(['b', 'text-1', 'a'])
    expect(test.state().selectedTextId).toBe('a')

    test.actions.patchTextItem('b', { text: 'patched' })
    expect(test.state().textItems.find((item) => item.id === 'b')?.text).toBe('patched')

    test.actions.deleteTextItem('a')
    expect(test.state().textItems.map((item) => item.id)).toEqual(['b', 'text-1'])
    expect(test.state().selectedTextId).toBeNull()
  })

  it('converts text move and resize deltas by viewport zoom and clamps to image bounds', () => {
    const moveItem = textItem('move')
    const move = harness({
      textItems: [moveItem],
      viewport: { zoom: 2 },
      natural: { w: 100, h: 100 },
    })
    move.actions.startTextMove(pointer({ clientX: 100, clientY: 100 }), moveItem)
    move.dragHandlers()!.onMove({ clientX: 120, clientY: 140 })
    expect(move.state().textItems[0]).toMatchObject({ x: 30, y: 50 })
    move.dragHandlers()!.onUp()
    expect(move.dragCleanupCount()).toBe(1)

    const resizeItem = textItem('resize', { fontSize: 20 })
    const resize = harness({ textItems: [resizeItem], viewport: { zoom: 2 } })
    resize.actions.startTextResize(pointer({ clientX: 100 }), resizeItem)
    resize.dragHandlers()!.onMove({ clientX: 120, clientY: 100 })
    expect(resize.state().textItems[0]?.fontSize).toBe(30)
  })

  it('deletes selected text with Delete or Backspace only while annotating and not editing', () => {
    const item = textItem('selected', { text: 'hello' })
    const test = harness({ textItems: [item] })
    expect(test.actions.deleteSelectedTextForKey('Delete')).toBe(false)

    test.state().annotating = false
    test.state().selectedTextId = 'selected'
    expect(test.actions.deleteSelectedTextForKey('Backspace')).toBe(false)

    test.state().annotating = true
    test.state().editingTextId = 'selected'
    expect(test.actions.deleteSelectedTextForKey('Delete')).toBe(false)

    test.state().editingTextId = null
    expect(test.actions.deleteSelectedTextForKey('Enter')).toBe(false)
    expect(test.state().textItems).toHaveLength(1)
    expect(test.actions.deleteSelectedTextForKey('Backspace')).toBe(true)
    expect(test.state().textItems).toEqual([])
    expect(test.state().selectedTextId).toBeNull()
  })

  it('moves one annotation between undo and redo stacks with stable ordering', () => {
    const one: AnnotateOp = { tool: 'brush', color: '#fff', size: 1, points: [] }
    const two: AnnotateOp = { tool: 'rect', color: '#000', size: 2, points: [] }
    const test = harness({ ops: [one, two] })

    test.actions.undoAnn()
    expect(test.state().ops).toEqual([one])
    expect(test.state().undone).toEqual([two])
    test.actions.undoAnn()
    expect(test.state().ops).toEqual([])
    expect(test.state().undone).toEqual([one, two])
    test.actions.redoAnn()
    expect(test.state().ops).toEqual([one])
    expect(test.state().undone).toEqual([two])
    test.actions.redoAnn()
    expect(test.state().ops).toEqual([one, two])
    expect(test.state().undone).toEqual([])
  })

  it('replaces an active pointer subscription and cleans it exactly once', () => {
    const item = textItem('drag')
    const test = harness({ textItems: [item], viewport: { zoom: 1 } })
    expect(test.subscribePointerDrag).not.toHaveBeenCalled()

    test.actions.startTextMove(pointer(), item)
    test.actions.startTextMove(pointer(), item)
    expect(test.subscribePointerDrag).toHaveBeenCalledTimes(2)
    expect(test.dragCleanupCount()).toBe(1)

    test.dragHandlers()!.onUp()
    expect(test.dragCleanupCount()).toBe(2)
    test.actions.dispose()
    expect(test.dragCleanupCount()).toBe(2)
  })

  it('resets every annotation state port and saves through the host port', async () => {
    const item = textItem('reset')
    const test = harness({
      tool: 'text',
      textItems: [item],
      ops: [{ tool: 'rect', color: '#fff', size: 1, points: [] }],
      selectedTextId: item.id,
      editingTextId: item.id,
      undone: [{ tool: 'brush', color: '#000', size: 1, points: [] }],
    })

    test.actions.resetAnnotation()
    expect(test.state()).toMatchObject({
      tool: 'brush',
      textItems: [],
      ops: [],
      selectedTextId: null,
      editingTextId: null,
      undone: [],
    })

    await test.actions.saveAnnotation('node-1', 'asset-url')
    expect(test.saveAnnotation).toHaveBeenCalledWith({
      nodeId: 'node-1',
      url: 'asset-url',
      ops: [],
      textItems: [],
    })
    expect(test.selectNode).toHaveBeenCalledWith('saved-node')
    expect(test.close).toHaveBeenCalledOnce()
    expect(test.state().saving).toBe(false)

    test.setNodeExists(false)
    test.close.mockClear()
    test.selectNode.mockClear()
    await test.actions.saveAnnotation('missing-node', 'asset-url')
    expect(test.close).not.toHaveBeenCalled()
    expect(test.selectNode).not.toHaveBeenCalled()
  })
})
