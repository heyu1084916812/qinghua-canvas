import { describe, expect, it } from 'vitest'
import {
  clamp,
  fromCanvasViewport,
  itemScreenRect,
  screenToWorkbenchWorld,
  toCanvasViewport,
  workbenchMinimapModel,
} from './workbenchGeometry'

describe('ecommerce workbench geometry', () => {
  it('round-trips viewport translation and clamps scale', () => {
    const viewport = { x: 48, y: 96, scale: 0.75 }
    expect(fromCanvasViewport(toCanvasViewport(viewport))).toEqual(viewport)
    expect(clamp(9, 0.1, 4)).toBe(4)
    expect(clamp(0, 0.1, 4)).toBe(0.1)
  })

  it('projects item rects and pointer positions in the same coordinate space', () => {
    const item = {
      id: 'a', projectId: 'p', kind: 'result', x: 100, y: 50,
      width: 200, height: 100, rotation: 0, assetHash: 'h', createdAt: 1,
    } as never
    const viewport = { x: 48, y: 48, scale: 0.5 }
    expect(itemScreenRect(item, viewport)).toEqual({ left: 98, top: 73, width: 100, height: 50 })
    const rect = { left: 0, top: 0, width: 800, height: 600 } as DOMRect
    const world = screenToWorkbenchWorld({ x: 98, y: 73 }, viewport, rect)
    expect(world.x).toBeCloseTo(100)
    expect(world.y).toBeCloseTo(50)
  })

  it('keeps the minimap viewport selector and selected item projection', () => {
    const model = workbenchMinimapModel(
      [{
        id: 'a', projectId: 'p', kind: 'result', x: 0, y: 0,
        width: 100, height: 100, rotation: 0, assetHash: 'h', createdAt: 1,
      } as never],
      new Set(['a']),
      { width: 800, height: 600 },
      { x: 0, y: 0, scale: 1 },
    )
    expect(model?.items[0]?.selected).toBe(true)
    expect(model?.viewportRect.width).toBeGreaterThan(0)
    expect(workbenchMinimapModel([], new Set(), { width: 0, height: 0 }, { x: 0, y: 0, scale: 1 })).toBeNull()
  })
})
