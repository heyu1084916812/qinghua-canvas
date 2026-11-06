import {
  clampAnnotateTextSize,
  moveAnnotateText,
  resizeAnnotateText,
  type AnnotateOp,
  type AnnotateTextItem,
  type AnnotateTool,
} from '../annotate/annotateOps'
import { isPrimaryPointer } from './lightboxKeyboard'
import { redoAnnotation, undoAnnotation } from './lightboxEditState'

export interface LightboxAnnotationState {
  tool: AnnotateTool
  color: string
  size: number
  ops: readonly AnnotateOp[]
  textItems: readonly AnnotateTextItem[]
  selectedTextId: string | null
  editingTextId: string | null
  undone: readonly AnnotateOp[]
  viewport: { zoom: number } | null
  natural: { w: number; h: number } | null
  annotating: boolean
  saving: boolean
}

export interface LightboxAnnotationPointer {
  button: number
  clientX: number
  clientY: number
  pointerId: number
  stopPropagation(): void
  preventDefault(): void
}

export interface LightboxAnnotationCanvas {
  left: number
  top: number
  width: number
  height: number
  pixelWidth: number
  pixelHeight: number
}

export interface LightboxPointerDragPoint {
  clientX: number
  clientY: number
}

export interface LightboxPointerDragHandlers {
  onMove(point: LightboxPointerDragPoint): void
  onUp(): void
}

export interface LightboxAnnotationPorts {
  state(): LightboxAnnotationState
  getDrawing(): AnnotateOp | null
  setDrawing(op: AnnotateOp | null): void
  setTextItems(update: (previous: AnnotateTextItem[]) => AnnotateTextItem[]): void
  setSelectedTextId(update: (previous: string | null) => string | null): void
  setEditingTextId(update: (previous: string | null) => string | null): void
  setOps(update: (previous: AnnotateOp[]) => AnnotateOp[]): void
  setUndone(update: (previous: AnnotateOp[]) => AnnotateOp[]): void
  setTool(tool: AnnotateTool): void
  setSaving(value: boolean): void
  capturePointer(pointerId: number): void
  scheduleTextEditing(id: string): void
  createTextId(): string
  subscribePointerDrag(handlers: LightboxPointerDragHandlers): () => void
  hasNode(nodeId: string): boolean
  saveAnnotation(input: {
    nodeId: string
    url: string
    ops: readonly AnnotateOp[]
    textItems: readonly AnnotateTextItem[]
  }): Promise<string | null | undefined>
  selectNode(id: string): void
  close(): void
}

export function lightboxAnnotationPointOf(
  clientX: number,
  clientY: number,
  canvas: LightboxAnnotationCanvas,
): { x: number; y: number } {
  return {
    x: ((clientX - canvas.left) / canvas.width) * canvas.pixelWidth,
    y: ((clientY - canvas.top) / canvas.height) * canvas.pixelHeight,
  }
}

export function createLightboxAnnotationActions(ports: LightboxAnnotationPorts) {
  let releasePointerDrag: (() => void) | null = null

  const releaseActivePointerDrag = () => {
    const release = releasePointerDrag
    releasePointerDrag = null
    release?.()
  }

  const beginPointerDrag = (onMove: (point: LightboxPointerDragPoint) => void) => {
    releaseActivePointerDrag()
    let active = true
    const end = () => {
      if (!active) return
      active = false
      releaseActivePointerDrag()
    }
    releasePointerDrag = ports.subscribePointerDrag({ onMove, onUp: end })
  }

  const patchTextItem = (id: string, patch: Partial<AnnotateTextItem>) => {
    ports.setTextItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  const deleteTextItem = (id: string) => {
    ports.setTextItems((previous) => previous.filter((item) => item.id !== id))
    ports.setSelectedTextId((current) => (current === id ? null : current))
    ports.setEditingTextId((current) => (current === id ? null : current))
  }

  const selectTextItem = (id: string) => {
    ports.setSelectedTextId(() => id)
    ports.setTextItems((previous) => {
      const item = previous.find((candidate) => candidate.id === id)
      if (!item || previous[previous.length - 1]?.id === id) return previous
      return [...previous.filter((candidate) => candidate.id !== id), item]
    })
  }

  const pointerDown = (
    event: LightboxAnnotationPointer,
    canvas: LightboxAnnotationCanvas,
    redraw: () => void,
  ) => {
    if (!isPrimaryPointer(event.button)) return
    releaseActivePointerDrag()
    event.stopPropagation()
    const point = lightboxAnnotationPointOf(event.clientX, event.clientY, canvas)
    const state = ports.state()
    if (state.tool === 'text') {
      const item: AnnotateTextItem = {
        id: ports.createTextId(),
        x: point.x,
        y: point.y,
        text: '',
        color: state.color,
        fontSize: clampAnnotateTextSize(Math.max(14, state.size * 5)),
      }
      ports.setTextItems((previous) => [...previous, item])
      ports.setSelectedTextId(() => item.id)
      ports.scheduleTextEditing(item.id)
      return
    }
    ports.capturePointer(event.pointerId)
    ports.setDrawing({
      tool: state.tool,
      color: state.color,
      size: state.size,
      points: [point],
    })
    redraw()
  }

  const pointerMove = (
    event: Pick<LightboxAnnotationPointer, 'clientX' | 'clientY'>,
    canvas: LightboxAnnotationCanvas,
    redraw: () => void,
  ) => {
    const drawing = ports.getDrawing()
    if (!drawing) return
    const point = lightboxAnnotationPointOf(event.clientX, event.clientY, canvas)
    if (drawing.tool === 'brush') drawing.points.push(point)
    else drawing.points[1] = point
    redraw()
  }

  const pointerUp = (redraw: () => void) => {
    const drawing = ports.getDrawing()
    ports.setDrawing(null)
    if (!drawing) return
    const start = drawing.points[0]
    const end = drawing.points[1]
    const tooSmall =
      drawing.tool === 'rect' &&
      (!start ||
        !end ||
        (Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3))
    if (tooSmall) {
      redraw()
      return
    }
    ports.setOps((previous) => [...previous, drawing])
    ports.setUndone(() => [])
  }

  const startTextMove = (
    event: LightboxAnnotationPointer,
    item: AnnotateTextItem,
  ) => {
    const state = ports.state()
    if (!isPrimaryPointer(event.button) || !state.viewport) return
    event.stopPropagation()
    event.preventDefault()
    selectTextItem(item.id)
    ports.setEditingTextId(() => null)
    const start = { x: event.clientX, y: event.clientY }
    const zoom = state.viewport.zoom
    const bounds = state.natural ? { w: state.natural.w, h: state.natural.h } : undefined
    beginPointerDrag((point) => {
      const dx = (point.clientX - start.x) / zoom
      const dy = (point.clientY - start.y) / zoom
      ports.setTextItems((previous) =>
        previous.map((current) =>
          current.id === item.id ? moveAnnotateText(item, dx, dy, bounds) : current,
        ),
      )
    })
  }

  const startTextResize = (
    event: LightboxAnnotationPointer,
    item: AnnotateTextItem,
  ) => {
    const state = ports.state()
    if (!isPrimaryPointer(event.button) || !state.viewport) return
    event.stopPropagation()
    event.preventDefault()
    selectTextItem(item.id)
    ports.setEditingTextId(() => null)
    const startX = event.clientX
    const zoom = state.viewport.zoom
    beginPointerDrag((point) => {
      const delta = (point.clientX - startX) / zoom
      ports.setTextItems((previous) =>
        previous.map((current) =>
          current.id === item.id
            ? resizeAnnotateText(item, item.fontSize + delta)
            : current,
        ),
      )
    })
  }

  const deleteSelectedTextForKey = (key: string): boolean => {
    const state = ports.state()
    if (
      !state.annotating ||
      !state.selectedTextId ||
      state.editingTextId ||
      (key !== 'Delete' && key !== 'Backspace')
    ) {
      return false
    }
    deleteTextItem(state.selectedTextId)
    return true
  }

  const undoAnn = () => {
    const next = undoAnnotation(ports.state().ops)
    ports.setOps(() => next.ops)
    if (next.undone.length > 0) {
      ports.setUndone((previous) => [...next.undone, ...previous])
    }
  }

  const redoAnn = () => {
    const state = ports.state()
    const next = redoAnnotation(state.ops, state.undone)
    ports.setOps(() => next.ops)
    ports.setUndone(() => next.undone)
  }

  const dispose = () => {
    releaseActivePointerDrag()
  }

  const resetAnnotation = () => {
    releaseActivePointerDrag()
    ports.setOps(() => [])
    ports.setTextItems(() => [])
    ports.setSelectedTextId(() => null)
    ports.setEditingTextId(() => null)
    ports.setUndone(() => [])
    ports.setTool('brush')
  }

  const saveAnnotation = async (nodeId: string, url: string | null | undefined) => {
    const state = ports.state()
    if (!nodeId || state.saving || !url || !ports.hasNode(nodeId)) return
    ports.setSaving(true)
    try {
      const id = await ports.saveAnnotation({
        nodeId,
        url,
        ops: state.ops,
        textItems: state.textItems,
      })
      if (id) ports.selectNode(id)
      ports.close()
    } finally {
      ports.setSaving(false)
    }
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    patchTextItem,
    deleteTextItem,
    selectTextItem,
    startTextMove,
    startTextResize,
    deleteSelectedTextForKey,
    undoAnn,
    redoAnn,
    resetAnnotation,
    saveAnnotation,
    dispose,
  }
}
