import { describe, expect, it } from 'vitest'
import { nodeOutsideViewport, shouldCullCanvasNode } from './nodeViewportCulling'

const surface = { w: 800, h: 600 }

describe('node viewport culling', () => {
  it('keeps a 320px screen-space warm margin around the viewport', () => {
    const node = { x: 1080, y: 100, w: 200, h: 160 }
    expect(
      nodeOutsideViewport(node, { x: 0, y: 0, zoom: 1 }, surface),
    ).toBe(false)
    expect(
      nodeOutsideViewport(node, { x: 0, y: 0, zoom: 0.5 }, surface),
    ).toBe(false)
  })

  it('culls only after the node is fully outside the warmed world rect', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    expect(
      nodeOutsideViewport({ x: 1121, y: 0, w: 200, h: 160 }, viewport, surface),
    ).toBe(true)
    expect(
      nodeOutsideViewport({ x: 0, y: 0, w: 200, h: 160 }, viewport, surface),
    ).toBe(false)
  })

  it('never culls container children or node types that can draw outside their frame', () => {
    expect(shouldCullCanvasNode({ type: 'prompt', parentId: null })).toBe(true)
    expect(shouldCullCanvasNode({ type: 'generation', parentId: null })).toBe(true)
    expect(shouldCullCanvasNode({ type: 'prompt', parentId: 'batch-1' })).toBe(false)
    expect(shouldCullCanvasNode({ type: 'loop', parentId: null })).toBe(false)
    expect(shouldCullCanvasNode({ type: 'fusion', parentId: null })).toBe(false)
  })

  it('does not cull before the surface has been measured', () => {
    expect(
      nodeOutsideViewport(
        { x: 5000, y: 5000, w: 200, h: 160 },
        { x: 0, y: 0, zoom: 1 },
        { w: 0, h: 0 },
      ),
    ).toBe(false)
  })
})
