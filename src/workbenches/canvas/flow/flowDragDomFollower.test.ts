import { describe, expect, it } from 'vitest'
import { shiftFlowEdgePath, writeFlowNodeDragDomPositions } from './flowDragDomFollower'

describe('flow drag DOM follower', () => {
  const path = 'M100,50 C120,50 180,80 200,80'

  it('moves the source endpoint and its control point', () => {
    expect(shiftFlowEdgePath(path, true, false, 30, -10)).toBe(
      'M130,40 C150,40 180,80 200,80',
    )
  })

  it('moves the target endpoint and its control point', () => {
    expect(shiftFlowEdgePath(path, false, true, 30, -10)).toBe(
      'M100,50 C120,50 210,70 230,70',
    )
  })

  it('ignores unsupported path syntax instead of writing junk', () => {
    expect(shiftFlowEdgePath('M 0 0 L 10 10', true, false, 4, 4)).toBeNull()
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
