import { describe, expect, it } from 'vitest'
import { getBezierPath, Position } from '@xyflow/react'
import {
  rebuildFlowEdgePath,
  writeFlowDragEdgePaths,
  writeFlowNodeDragDomPositions,
  type FlowDragEdgePathSnapshot,
} from './flowDragDomFollower'
import { toScreenPath } from './childEdges'

const scaleFlowPath = (d: string, z: number) => toScreenPath(d, { x: 0, y: 0 }, z)

const rf = (sx: number, sy: number, tx: number, ty: number) =>
  getBezierPath({ sourceX: sx, sourceY: sy, sourcePosition: Position.Right, targetX: tx, targetY: ty, targetPosition: Position.Left })

describe('flow drag DOM follower', () => {
  const path = 'M100,50 C120,50 180,80 200,80'

  it('re-solves the curve exactly like React Flow after moving the source', () => {
    const [d, midX, midY] = rf(130, 40, 200, 80)
    expect(rebuildFlowEdgePath(path, true, false, 30, -10)).toEqual({ path: d, midX, midY })
  })

  it('re-solves reversed edges (target left of source) like React Flow', () => {
    expect(rebuildFlowEdgePath(path, false, true, -300, 0)?.path).toBe(rf(100, 50, -100, 80)[0])
  })

  it('works on screen-space child edges via scale', () => {
    const screen = scaleFlowPath(rf(10, 10, 60, 30)[0], 2)
    expect(rebuildFlowEdgePath(screen, true, false, 5, 0, { scale: 2 })?.path).toBe(
      scaleFlowPath(rf(15, 10, 60, 30)[0], 2),
    )
  })

  it('ignores unsupported path syntax instead of writing junk', () => {
    expect(rebuildFlowEdgePath('M 0 0 L 10 10', true, false, 4, 4)).toBeNull()
  })

  it('moves the delete button to the new midpoint and never rewrites its cross', () => {
    const attrs = new Map<string, string>()
    const el = (d: string) => ({ setAttribute: (k: string, v: string) => attrs.set(`${d}:${k}`, v) }) as unknown as Element
    const snapshot: FlowDragEdgePathSnapshot = {
      source: 'a', target: 'b', sourcePosition: Position.Right, targetPosition: Position.Left, scale: 1,
      paths: [{ element: el('visual'), d: path }],
      deleteButton: { element: el('delete'), transform: 'translate(150, 65) scale(0.5)' },
    }
    writeFlowDragEdgePaths([snapshot], new Set(['a']), 30, -10)
    const [d, midX, midY] = rf(130, 40, 200, 80)
    expect(attrs.get('visual:d')).toBe(d)
    expect(attrs.get('delete:transform')).toBe(`translate(${midX}, ${midY}) scale(0.5)`)
    expect([...attrs.keys()]).toEqual(['visual:d', 'delete:transform'])
  })

  it('follows pointer deltas directly on node wrappers', () => {
    const style = { transform: '' }
    const host = { querySelector: () => ({ style }) }
    expect(
      writeFlowNodeDragDomPositions(
        host,
        [{ id: 'node-a', x: 40, y: 60 }],
        35.5,
        -12,
      ),
    ).toBe(1)
    expect(style.transform).toBe('translate(75.5px, 48px)')
  })
})
