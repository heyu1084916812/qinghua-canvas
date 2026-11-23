import { describe, expect, it, vi } from 'vitest'
import { writeFlowNodeDomPositions } from './flowNodeDomPositions'

describe('flow node DOM positions', () => {
  it('writes each pointer-frame transform before React commits', () => {
    const style = { transform: '' }
    const host = {
      querySelector: vi.fn(() => ({ style })),
    }
    expect(
      writeFlowNodeDomPositions(host, [
        { type: 'position', id: 'node-a', position: { x: 12, y: 34 } },
        { type: 'position', id: 'node-a', position: { x: 56, y: 78 } },
      ]),
    ).toBe(2)
    expect(style.transform).toBe('translate(56px, 78px)')
  })

  it('ignores non-position changes and missing wrappers', () => {
    const host = { querySelector: vi.fn(() => null) }
    expect(
      writeFlowNodeDomPositions(host, [
        { type: 'select', id: 'node-a', selected: true },
        { type: 'position', id: 'node-b', position: { x: 1, y: 2 } },
      ]),
    ).toBe(0)
    expect(host.querySelector).toHaveBeenCalledOnce()
  })

})
