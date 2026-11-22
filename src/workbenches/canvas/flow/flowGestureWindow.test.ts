import { describe, expect, it } from 'vitest'
import {
  PAN_NODE_WINDOW_MARGIN_PX,
  nodesInGestureWindow,
  type PositionedFlowNode,
} from './flowGestureWindow'

const node = (id: string, x: number, y: number): PositionedFlowNode & { id: string } => ({
  id,
  position: { x, y },
  width: 200,
  height: 160,
})

describe('flow gesture window', () => {
  it('keeps nodes inside the viewport plus the configured warm margin', () => {
    const nodes = [
      node('center', 400, 300),
      node('inside-margin', -900, 100),
      node('outside-left', -1300, 100),
      node('outside-below', 400, 2600),
    ]
    const kept = nodesInGestureWindow(
      nodes,
      { x: 0, y: 0, zoom: 1 },
      { w: 1000, h: 800 },
    )
    expect(kept.map((entry) => entry.id)).toEqual(['center', 'inside-margin'])
    expect(PAN_NODE_WINDOW_MARGIN_PX).toBe(1000)
  })

  it('converts the screen margin to world units with zoom', () => {
    const nodes = [node('edge', 900, 100), node('far', 1300, 100)]
    const kept = nodesInGestureWindow(
      nodes,
      { x: 0, y: 0, zoom: 2 },
      { w: 1000, h: 800 },
    )
    expect(kept.map((entry) => entry.id)).toEqual(['edge'])
  })

  it('does not filter before the surface has been measured', () => {
    const nodes = [node('a', 0, 0), node('b', 5000, 5000)]
    expect(
      nodesInGestureWindow(nodes, { x: 0, y: 0, zoom: 1 }, null).map((entry) => entry.id),
    ).toEqual(['a', 'b'])
  })
})
