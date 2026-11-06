import { describe, expect, it, vi } from 'vitest'
import * as workbenchGeometry from '../workbenchGeometry'
import type { EcommerceWorkbenchAction as EntryAction } from '../EcommerceWorkbench'
import * as workbenchInteraction from './workbenchInteraction'
import {
  MIN_SCALE,
  MAX_SCALE,
  MIN_ITEM_SIZE,
  MINIMAP_PADDING,
  createWorkbenchTextItem,
  createWorkbenchUploadedItem,
  fitWorkbenchItemsViewport,
  marqueeSelectionIds,
  movedWorkbenchItems,
  nextWorkbenchObjectPosition,
  panWorkbenchViewport,
  resizedWorkbenchItems,
  rotatedWorkbenchItems,
  selectedWorkbenchActions,
  wheelWorkbenchViewport,
  workbenchBlankInteraction,
  workbenchMarqueeSelection,
  workbenchMoveInteraction,
  workbenchPointerBox,
  workbenchResizeInteraction,
  workbenchRotateInteraction,
  workbenchUploadedSize,
  workbenchViewportFromMinimapPointer,
  type EcommerceWorkbenchAction,
  type EcommerceWorkbenchProps,
  type WorkbenchAction,
} from './workbenchContracts'

const ENTRY_SOURCE = (
  import.meta.glob('../EcommerceWorkbench.tsx', {
    eager: true, query: '?raw', import: 'default',
  }) as Record<string, string>
)['../EcommerceWorkbench.tsx']

const item = (id: string, zIndex = 1) => ({
  id,
  projectId: 'p',
  kind: 'image',
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  zIndex,
  aspectLocked: false,
  autoLayout: false,
  createdAt: 1,
  updatedAt: 1,
}) as never

describe('ecommerce workbench contracts', () => {
  it('keeps the geometry constants and their source of truth', () => {
    expect([MIN_SCALE, MAX_SCALE, MIN_ITEM_SIZE, MINIMAP_PADDING]).toEqual([0.1, 4, 96, 9])
    expect(MIN_SCALE).toBe(workbenchGeometry.MIN_SCALE)
    expect(MAX_SCALE).toBe(workbenchGeometry.MAX_SCALE)
    expect(MIN_ITEM_SIZE).toBe(workbenchGeometry.MIN_ITEM_SIZE)
    expect(MINIMAP_PADDING).toBe(workbenchGeometry.MINIMAP_PADDING)
  })

  it('keeps the contract type re-exports and the old entry public API identity', () => {
    const contractAction: EcommerceWorkbenchAction = 'save'
    const entryAction: EntryAction = contractAction
    const interactionAction: WorkbenchAction = entryAction
    const props: Pick<EcommerceWorkbenchProps, 'projectId' | 'items' | 'results' | 'tasks' | 'onItemsChange'> = {
      projectId: 'p',
      items: [],
      results: [],
      tasks: [],
      onItemsChange: () => {},
    }
    expect([contractAction, entryAction, interactionAction]).toEqual(['save', 'save', 'save'])
    expect(props.projectId).toBe('p')
    expect(ENTRY_SOURCE).toContain('export type EcommerceWorkbenchAction = WorkbenchAction')
    expect(ENTRY_SOURCE).toContain('export function EcommerceWorkbench({')
    expect(ENTRY_SOURCE).toContain("from './workbench/workbenchContracts'")
  })

  it('re-exports the workbench interaction helpers by identity', () => {
    const pairs = [
      [marqueeSelectionIds, workbenchInteraction.marqueeSelectionIds],
      [movedWorkbenchItems, workbenchInteraction.movedWorkbenchItems],
      [nextWorkbenchObjectPosition, workbenchInteraction.nextWorkbenchObjectPosition],
      [resizedWorkbenchItems, workbenchInteraction.resizedWorkbenchItems],
      [rotatedWorkbenchItems, workbenchInteraction.rotatedWorkbenchItems],
      [selectedWorkbenchActions, workbenchInteraction.selectedWorkbenchActions],
      [workbenchBlankInteraction, workbenchInteraction.workbenchBlankInteraction],
      [workbenchMarqueeSelection, workbenchInteraction.workbenchMarqueeSelection],
      [workbenchMoveInteraction, workbenchInteraction.workbenchMoveInteraction],
      [workbenchPointerBox, workbenchInteraction.workbenchPointerBox],
      [workbenchResizeInteraction, workbenchInteraction.workbenchResizeInteraction],
      [workbenchRotateInteraction, workbenchInteraction.workbenchRotateInteraction],
    ] as const
    for (const [actual, expected] of pairs) expect(actual).toBe(expected)
  })

  it('builds text and uploaded objects with the original fields and z-order', () => {
    const createId = vi.fn(() => 'eci_fixed')
    const now = vi.fn()
      .mockReturnValueOnce(10).mockReturnValueOnce(11)
      .mockReturnValueOnce(10).mockReturnValueOnce(11)
    const ports = { createId, now }
    const text = createWorkbenchTextItem({
      projectId: 'p',
      position: { x: 20, y: 30 },
      items: [item('old', 7)],
    }, ports)
    expect(text).toEqual({
      id: 'eci_fixed',
      projectId: 'p',
      kind: 'text',
      text: '输入文字',
      x: 20,
      y: 30,
      width: 280,
      height: 84,
      rotation: 0,
      zIndex: 8,
      aspectLocked: false,
      autoLayout: false,
      createdAt: 10,
      updatedAt: 11,
    })
    expect(createId).toHaveBeenCalledWith('eci')
    expect(now).toHaveBeenCalledTimes(2)

    expect(workbenchUploadedSize({ hash: 'h', width: 800, height: 400 })).toEqual({ width: 520, height: 260 })
    expect(workbenchUploadedSize({ hash: 'h' })).toEqual({ width: 520, height: 520 })
    expect(workbenchUploadedSize({ hash: 'h', width: 4000, height: 100 })).toEqual({ width: 520, height: 120 })
    const uploaded = createWorkbenchUploadedItem({
      projectId: 'p',
      uploaded: { hash: 'asset-hash', width: 800, height: 400 },
      position: { x: 40, y: 50 },
      size: { width: 520, height: 260 },
      items: [item('old', 2), item('older', 5)],
    }, ports)
    expect(uploaded).toEqual({
      id: 'eci_fixed',
      projectId: 'p',
      kind: 'image',
      assetHash: 'asset-hash',
      x: 40,
      y: 50,
      width: 520,
      height: 260,
      rotation: 0,
      zIndex: 6,
      aspectLocked: true,
      autoLayout: false,
      createdAt: 10,
      updatedAt: 11,
    })
  })

  it('keeps fit, pan and wheel viewport geometry within the same bounds', () => {
    const rect = { left: 10, top: 20, width: 800, height: 600 }
    const fitted = fitWorkbenchItemsViewport([item('a')], rect, 72)
    expect(workbenchGeometry.fromCanvasViewport(workbenchGeometry.toCanvasViewport(fitted))).toEqual(fitted)
    expect(fitted.scale).toBeGreaterThan(0)
    expect(panWorkbenchViewport({ x: 48, y: 96, scale: 0.5 }, 12, -8)).toEqual({ x: 60, y: 88, scale: 0.5 })
    const zoomIn = wheelWorkbenchViewport(
      { x: 0, y: 0, scale: 1 },
      { clientX: 400, clientY: 300, deltaY: -1000 },
      rect,
    )
    const zoomOut = wheelWorkbenchViewport(
      { x: 0, y: 0, scale: 1 },
      { clientX: 400, clientY: 300, deltaY: 1000 },
      rect,
    )
    expect(zoomIn.scale).toBeGreaterThan(1)
    expect(zoomIn.scale).toBeLessThanOrEqual(MAX_SCALE)
    expect(zoomOut.scale).toBeLessThan(1)
    expect(zoomOut.scale).toBeGreaterThanOrEqual(MIN_SCALE)
  })

  it('converts minimap pointer coordinates with the original padding and scale', () => {
    const viewport = workbenchViewportFromMinimapPointer({
      minimap: {
        bounds: { minX: 100, minY: 200, maxX: 900, maxY: 700 },
        scale: 0.5,
      },
      event: { clientX: 118, clientY: 223 },
      rect: { left: 10, top: 20 },
      size: { width: 800, height: 600 },
      scale: 1,
    })
    expect(viewport).toEqual({ x: 102, y: -288, scale: 1 })
  })
})
