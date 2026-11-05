import { findFreeWorkbenchPosition, snapWorkbenchMove, type EcommerceCanvasItem } from '../../../domain/ecommerce/canvasItem'
import type { EcommerceResultRecord } from '../../../domain/ecommerce/tasks'
import { workbenchBlankDragIntent } from '../../../domain/ecommerce/workbenchGesture'
import {
  itemScreenRect,
  screenToWorkbenchWorld,
  type Point,
  type ResizeHandle,
  type Viewport,
} from '../workbenchGeometry'

export type WorkbenchTool = 'select' | 'hand'
export type WorkbenchAction = 'download' | 'save' | 'retry'

export interface WorkbenchInteraction {
  kind: 'move' | 'resize' | 'rotate' | 'pan' | 'marquee'
  itemId?: string
  handle?: ResizeHandle
  startClient: Point
  startViewport: Viewport
  startItem?: EcommerceCanvasItem
  startItems?: EcommerceCanvasItem[]
  startWorld: Point
  center?: Point
  startAngle?: number
  additive?: boolean
  button?: number
  moved: boolean
}

export type WorkbenchRect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

export function workbenchPointerWorld(
  point: Point,
  viewport: Viewport,
  rect: WorkbenchRect,
): Point {
  return screenToWorkbenchWorld(point, viewport, rect as DOMRect)
}

export function workbenchSelectionAfterItemPointer(
  selectedIds: ReadonlySet<string>,
  itemId: string,
  additive: boolean,
): Set<string> {
  if (additive) {
    const next = new Set(selectedIds)
    if (next.has(itemId)) next.delete(itemId)
    else next.add(itemId)
    return next
  }
  return selectedIds.has(itemId) ? new Set(selectedIds) : new Set([itemId])
}

export function workbenchMoveInteraction(
  input: {
    event: { clientX: number; clientY: number }
    item: EcommerceCanvasItem
    selectedIds: ReadonlySet<string>
    additive: boolean
    items: readonly EcommerceCanvasItem[]
    viewport: Viewport
    rect: WorkbenchRect
  },
): { selection: Set<string>; interaction: WorkbenchInteraction } {
  const selection = workbenchSelectionAfterItemPointer(
    input.selectedIds,
    input.item.id,
    input.additive,
  )
  const interaction: WorkbenchInteraction = {
    kind: 'move',
    itemId: input.item.id,
    startClient: { x: input.event.clientX, y: input.event.clientY },
    startViewport: input.viewport,
    startItem: input.item,
    startItems: input.items.filter((candidate) => selection.has(candidate.id)),
    startWorld: workbenchPointerWorld(
      { x: input.event.clientX, y: input.event.clientY },
      input.viewport,
      input.rect,
    ),
    moved: false,
  }
  return { selection, interaction }
}

export function workbenchResizeInteraction(input: {
  event: { clientX: number; clientY: number }
  item: EcommerceCanvasItem
  handle: ResizeHandle
  viewport: Viewport
  rect: WorkbenchRect
}): WorkbenchInteraction {
  return {
    kind: 'resize',
    itemId: input.item.id,
    handle: input.handle,
    startClient: { x: input.event.clientX, y: input.event.clientY },
    startViewport: input.viewport,
    startItem: input.item,
    startWorld: workbenchPointerWorld(
      { x: input.event.clientX, y: input.event.clientY },
      input.viewport,
      input.rect,
    ),
    moved: false,
  }
}

export function workbenchRotateInteraction(input: {
  event: { clientX: number; clientY: number }
  item: EcommerceCanvasItem
  viewport: Viewport
  rect: WorkbenchRect
}): WorkbenchInteraction {
  const world = workbenchPointerWorld(
    { x: input.event.clientX, y: input.event.clientY },
    input.viewport,
    input.rect,
  )
  const center = {
    x: input.item.x + input.item.width / 2,
    y: input.item.y + input.item.height / 2,
  }
  return {
    kind: 'rotate',
    itemId: input.item.id,
    startClient: { x: input.event.clientX, y: input.event.clientY },
    startViewport: input.viewport,
    startItem: input.item,
    startWorld: world,
    center,
    startAngle: Math.atan2(world.y - center.y, world.x - center.x) -
      (input.item.rotation * Math.PI) / 180,
    moved: false,
  }
}

export function workbenchBlankInteraction(input: {
  event: {
    button: number
    clientX: number
    clientY: number
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
  }
  tool: WorkbenchTool
  spaceHeld: boolean
  viewport: Viewport
  rect: WorkbenchRect
}): { interaction: WorkbenchInteraction; selectionBox: {
  left: number
  top: number
  width: number
  height: number
} | null } | null {
  const intent = workbenchBlankDragIntent({
    button: input.event.button,
    tool: input.tool,
    spaceHeld: input.spaceHeld,
    ctrlKey: input.event.ctrlKey,
    metaKey: input.event.metaKey,
  })
  if (intent === 'none') return null
  if (intent === 'marquee') {
    return {
      selectionBox: {
        left: input.event.clientX - input.rect.left,
        top: input.event.clientY - input.rect.top,
        width: 0,
        height: 0,
      },
      interaction: {
        kind: 'marquee',
        startClient: { x: input.event.clientX, y: input.event.clientY },
        startViewport: input.viewport,
        startWorld: { x: 0, y: 0 },
        additive: input.event.shiftKey,
        button: input.event.button,
        moved: false,
      },
    }
  }
  return {
    selectionBox: null,
    interaction: {
      kind: 'pan',
      startClient: { x: input.event.clientX, y: input.event.clientY },
      startViewport: input.viewport,
      startWorld: { x: 0, y: 0 },
      button: input.event.button,
      moved: false,
    },
  }
}

export function marqueeSelectionIds(
  items: readonly EcommerceCanvasItem[],
  viewport: Viewport,
  box: { left: number; top: number; width: number; height: number } | null,
  moved: boolean,
): string[] {
  if (!moved || !box) return []
  return items.filter((item) => {
    const screen = itemScreenRect(item, viewport)
    return (
      screen.left + screen.width >= box.left &&
      screen.left <= box.left + box.width &&
      screen.top + screen.height >= box.top &&
      screen.top <= box.top + box.height
    )
  }).map((item) => item.id)
}

export function workbenchMarqueeSelection(
  current: ReadonlySet<string>,
  next: readonly string[],
  additive: boolean,
): Set<string> {
  return new Set(additive ? [...current, ...next] : next)
}

export function workbenchPointerBox(
  interaction: WorkbenchInteraction,
  event: { clientX: number; clientY: number },
  rect: WorkbenchRect,
): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(interaction.startClient.x, event.clientX) - rect.left,
    top: Math.min(interaction.startClient.y, event.clientY) - rect.top,
    width: Math.abs(event.clientX - interaction.startClient.x),
    height: Math.abs(event.clientY - interaction.startClient.y),
  }
}

export function movedWorkbenchItems(
  interaction: WorkbenchInteraction,
  current: readonly EcommerceCanvasItem[],
  event: { clientX: number; clientY: number },
  rect: WorkbenchRect,
): { items: EcommerceCanvasItem[]; guides: { x: number | null; y: number | null } } {
  const item = interaction.startItem
  if (!item) return { items: [...current], guides: { x: null, y: null } }
  const world = workbenchPointerWorld(
    { x: event.clientX, y: event.clientY },
    interaction.startViewport,
    rect,
  )
  const rawX = item.x + world.x - interaction.startWorld.x
  const rawY = item.y + world.y - interaction.startWorld.y
  const snapped = snapWorkbenchMove(
    item,
    rawX,
    rawY,
    current.filter(
      (candidate) => !interaction.startItems?.some((moving) => moving.id === candidate.id),
    ),
    interaction.startViewport.scale,
  )
  const deltaX = snapped.x - item.x
  const deltaY = snapped.y - item.y
  const moving = new Map(
    (interaction.startItems ?? [item]).map((candidate) => [candidate.id, candidate] as const),
  )
  return {
    guides: snapped.guides,
    items: current.map((candidate) =>
      moving.has(candidate.id)
        ? {
            ...candidate,
            x: moving.get(candidate.id)!.x + deltaX,
            y: moving.get(candidate.id)!.y + deltaY,
            autoLayout: false,
          }
        : candidate,
    ),
  }
}

export function rotatedWorkbenchItems(
  interaction: WorkbenchInteraction,
  current: readonly EcommerceCanvasItem[],
  event: { clientX: number; clientY: number },
  rect: WorkbenchRect,
): EcommerceCanvasItem[] {
  if (!interaction.center || !interaction.startItem) return [...current]
  const world = workbenchPointerWorld(
    { x: event.clientX, y: event.clientY },
    interaction.startViewport,
    rect,
  )
  const angle =
    (Math.atan2(world.y - interaction.center.y, world.x - interaction.center.x) -
      (interaction.startAngle ?? 0)) *
    (180 / Math.PI)
  return current.map((candidate) =>
    candidate.id === interaction.startItem?.id ? { ...candidate, rotation: angle } : candidate,
  )
}

export function resizedWorkbenchItems(
  interaction: WorkbenchInteraction,
  current: readonly EcommerceCanvasItem[],
  event: { clientX: number; clientY: number },
  rect: WorkbenchRect,
  minItemSize = 96,
): EcommerceCanvasItem[] {
  const item = interaction.startItem
  const handle = interaction.handle
  if (!item || !handle) return [...current]
  const world = workbenchPointerWorld(
    { x: event.clientX, y: event.clientY },
    interaction.startViewport,
    rect,
  )
  const aspect = item.width / Math.max(1, item.height)
  let width = item.width
  let height = item.height
  let x = item.x
  let y = item.y
  if (handle.includes('e')) width = Math.max(minItemSize, item.width + world.x - interaction.startWorld.x)
  if (handle.includes('s')) height = Math.max(minItemSize, item.height + world.y - interaction.startWorld.y)
  if (handle.includes('w')) {
    width = Math.max(minItemSize, item.width - (world.x - interaction.startWorld.x))
    x = item.x + item.width - width
  }
  if (handle.includes('n')) {
    height = Math.max(minItemSize, item.height - (world.y - interaction.startWorld.y))
    y = item.y + item.height - height
  }
  if (handle.length === 2 && item.aspectLocked) {
    const scale = Math.max(width / item.width, height / item.height)
    width = Math.max(minItemSize, item.width * scale)
    height = width / aspect
    if (handle.includes('w')) x = item.x + item.width - width
    if (handle.includes('n')) y = item.y + item.height - height
  }
  return current.map((candidate) =>
    candidate.id === item.id ? { ...candidate, x, y, width, height, autoLayout: false } : candidate,
  )
}

export function nextWorkbenchObjectPosition(
  items: readonly EcommerceCanvasItem[],
  width: number,
  height: number,
  viewport: Viewport,
  rect: WorkbenchRect | null,
): Point {
  const center = rect
    ? workbenchPointerWorld(
        { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        viewport,
        rect,
      )
    : { x: 160, y: 120 }
  return findFreeWorkbenchPosition(
    items,
    width,
    height,
    { x: center.x - width / 2, y: center.y - height / 2 },
  )
}

export function selectedWorkbenchActions(
  status: 'running' | 'done' | 'failed' | null,
  assetHash: string | undefined,
  result: Pick<EcommerceResultRecord, 'recovery'> | null,
): readonly (readonly [WorkbenchAction, string])[] {
  return [
    ...(status === 'failed'
      ? ([[
          'retry',
          result?.recovery === 'retry-save' ? '重试保存' : '重新生成',
        ]] as const)
      : []),
    ...(assetHash
      ? ([
          ['download', '下载'],
          ['save', '收藏到素材库'],
        ] as const)
      : []),
  ]
}

export function workbenchRunLogStateOf(input: {
  runs: readonly { status: string }[]
  tasks: readonly unknown[]
}): 'runs' | 'empty' | 'tasks' {
  if (input.runs.length > 0) return 'runs'
  return input.tasks.length === 0 ? 'empty' : 'tasks'
}
