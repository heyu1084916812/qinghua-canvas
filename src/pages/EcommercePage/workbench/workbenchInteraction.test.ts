import { describe, expect, it } from 'vitest'
import {
  marqueeSelectionIds,
  movedWorkbenchItems,
  nextWorkbenchObjectPosition,
  resizedWorkbenchItems,
  rotatedWorkbenchItems,
  selectedWorkbenchActions,
  workbenchBlankInteraction,
  workbenchMarqueeSelection,
  workbenchMoveInteraction,
  workbenchPointerBox,
  workbenchResizeInteraction,
  workbenchRotateInteraction,
  workbenchRunLogStateOf,
  workbenchSelectionAfterItemPointer,
  type WorkbenchRect,
} from './workbenchInteraction'

const rect: WorkbenchRect = { left: 0, top: 0, width: 800, height: 600 }
const viewport = { x: 0, y: 0, scale: 1 }
const item = (id: string, x = 0, y = 0, width = 100, height = 100) => ({
  id,
  projectId: 'p',
  kind: 'image',
  x,
  y,
  width,
  height,
  rotation: 0,
  zIndex: 1,
  aspectLocked: false,
  autoLayout: true,
  createdAt: 1,
  updatedAt: 1,
}) as never

describe('ecommerce workbench interaction', () => {
  it('keeps single, additive and batch selection semantics', () => {
    expect([...workbenchSelectionAfterItemPointer(new Set(['a', 'b']), 'c', false)]).toEqual(['c'])
    expect([...workbenchSelectionAfterItemPointer(new Set(['a', 'b']), 'b', false)]).toEqual(['a', 'b'])
    expect([...workbenchSelectionAfterItemPointer(new Set(['a', 'b']), 'b', true)]).toEqual(['a'])
    expect([...workbenchSelectionAfterItemPointer(new Set(['a']), 'b', true)]).toEqual(['a', 'b'])
    const move = workbenchMoveInteraction({
      event: { clientX: 20, clientY: 30 },
      item: item('a'),
      selectedIds: new Set(['a', 'b']),
      additive: false,
      items: [item('a'), item('b', 200), item('c', 400)],
      viewport,
      rect,
    })
    expect(move.interaction.startItems?.map((candidate) => candidate.id)).toEqual(['a', 'b'])
    expect(move.interaction.startWorld).toEqual({ x: 20, y: 30 })
  })

  it('keeps resize, rotate and blank gestures with the same coordinate origin', () => {
    const resized = workbenchResizeInteraction({
      event: { clientX: 10, clientY: 10 }, item: item('a'), handle: 'se', viewport, rect,
    })
    expect(resized).toMatchObject({ kind: 'resize', handle: 'se', startWorld: { x: 10, y: 10 } })
    const rotated = workbenchRotateInteraction({
      event: { clientX: 150, clientY: 50 }, item: item('a'), viewport, rect,
    })
    expect(rotated.center).toEqual({ x: 50, y: 50 })
    expect(rotated.startAngle).toBeCloseTo(0)

    const pan = workbenchBlankInteraction({
      event: { button: 0, clientX: 5, clientY: 6, ctrlKey: false, metaKey: false, shiftKey: false },
      tool: 'select', spaceHeld: false, viewport, rect,
    })
    expect(pan?.interaction.kind).toBe('pan')
    const marquee = workbenchBlankInteraction({
      event: { button: 0, clientX: 5, clientY: 6, ctrlKey: true, metaKey: false, shiftKey: true },
      tool: 'select', spaceHeld: false, viewport, rect,
    })
    expect(marquee?.interaction.kind).toBe('marquee')
    expect(marquee?.interaction.additive).toBe(true)
    expect(marquee?.selectionBox).toEqual({ left: 5, top: 6, width: 0, height: 0 })
    expect(workbenchBlankInteraction({
      event: { button: 2, clientX: 0, clientY: 0, ctrlKey: false, metaKey: false, shiftKey: false },
      tool: 'select', spaceHeld: false, viewport, rect,
    })).toBeNull()
  })

  it('uses touch-edge marquee and additive union, not point-center selection', () => {
    const items = [item('inside', 10, 10), item('touch', 100, 10), item('outside', 400, 400)]
    const ids = marqueeSelectionIds(items, viewport, { left: 0, top: 0, width: 110, height: 110 }, true)
    expect(ids).toEqual(['inside', 'touch'])
    expect(marqueeSelectionIds(items, viewport, null, true)).toEqual([])
    expect([...workbenchMarqueeSelection(new Set(['old']), ids, true)]).toEqual(['old', 'inside', 'touch'])
    expect([...workbenchMarqueeSelection(new Set(['old']), ids, false)]).toEqual(['inside', 'touch'])
    const interaction = workbenchMoveInteraction({
      event: { clientX: 0, clientY: 0 }, item: item('a'), selectedIds: new Set(), additive: false,
      items: [], viewport, rect,
    }).interaction
    expect(workbenchPointerBox(interaction, { clientX: 30, clientY: -20 }, rect)).toEqual({
      left: 0, top: -20, width: 30, height: 20,
    })
  })

  it('applies the same world delta to every selected item and disables auto layout', () => {
    const interaction = workbenchMoveInteraction({
      event: { clientX: 0, clientY: 0 }, item: item('a', 20, 30), selectedIds: new Set(['a', 'b']),
      additive: false, items: [item('a', 20, 30), item('b', 100, 30)], viewport, rect,
    }).interaction
    const result = movedWorkbenchItems(
      interaction,
      [item('a', 20, 30), item('b', 100, 30), item('c', 400, 30)],
      { clientX: 40, clientY: 50 },
      rect,
    )
    expect(result.items.slice(0, 2).map((candidate) => [candidate.x, candidate.y, candidate.autoLayout])).toEqual([
      [60, 80, false],
      [140, 80, false],
    ])
    expect(result.items[2]).toMatchObject({ x: 400, y: 30, autoLayout: true })
  })

  it('keeps rotation, minimum resize, aspect-lock and free-position rules', () => {
    const rotation = workbenchRotateInteraction({
      event: { clientX: 150, clientY: 50 }, item: item('a'), viewport, rect,
    })
    expect(rotatedWorkbenchItems(rotation, [item('a')], { clientX: 50, clientY: 150 }, rect)[0]?.rotation)
      .toBeCloseTo(90)

    const resize = workbenchResizeInteraction({
      event: { clientX: 100, clientY: 100 }, item: item('a'), handle: 'se', viewport, rect,
    })
    expect(resizedWorkbenchItems(resize, [item('a')], { clientX: 100, clientY: 100 }, rect)[0])
      .toMatchObject({ width: 100, height: 100, autoLayout: false })
    const shrinking = resizedWorkbenchItems(
      { ...resize, handle: 'nw' },
      [item('a')],
      { clientX: 1000, clientY: 1000 },
      rect,
    )[0]
    expect(shrinking?.width).toBe(96)
    expect(shrinking?.height).toBe(96)

    const position = nextWorkbenchObjectPosition([item('a', 0, 0, 200, 200)], 100, 100, viewport, rect)
    expect(position.x).toBeGreaterThanOrEqual(200)
  })

  it('keeps action labels, retry-save wording and log projection branches', () => {
    expect(selectedWorkbenchActions('failed', 'hash', { recovery: 'retry-save' })).toEqual([
      ['retry', '重试保存'], ['download', '下载'], ['save', '收藏到素材库'],
    ])
    expect(selectedWorkbenchActions('done', undefined, null)).toEqual([])
    expect(workbenchRunLogStateOf({ runs: [{ status: 'failed' }], tasks: [] })).toBe('runs')
    expect(workbenchRunLogStateOf({ runs: [], tasks: [] })).toBe('empty')
    expect(workbenchRunLogStateOf({ runs: [], tasks: [{}] })).toBe('tasks')
  })
})
