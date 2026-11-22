import { describe, expect, it, vi } from 'vitest'
import { createFlowNodePositionBatcher } from './flowNodePositionBatcher'

describe('flow node position batcher', () => {
  it('applies only the latest position for each node once per frame', () => {
    const callbacks: Array<() => void> = []
    const apply = vi.fn()
    const cancelFrame = vi.fn()
    const batcher = createFlowNodePositionBatcher({
      apply,
      requestFrame: (next) => {
        callbacks.push(next)
        return 1
      },
      cancelFrame,
    })

    batcher.queue([
      { type: 'position', id: 'a', position: { x: 10, y: 10 } },
      { type: 'position', id: 'b', position: { x: 20, y: 20 } },
    ])
    batcher.queue([
      { type: 'position', id: 'a', position: { x: 30, y: 40 } },
      { type: 'select', id: 'a', selected: true },
    ])
    expect(apply).not.toHaveBeenCalled()
    callbacks[0]?.()
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith([
      { type: 'position', id: 'a', position: { x: 30, y: 40 } },
      { type: 'position', id: 'b', position: { x: 20, y: 20 } },
    ])
  })

  it('flushes pending positions before drag end and cancels stale frames', () => {
    const callbacks: Array<() => void> = []
    const apply = vi.fn()
    const cancelFrame = vi.fn()
    const batcher = createFlowNodePositionBatcher({
      apply,
      requestFrame: (next) => {
        callbacks.push(next)
        return 7
      },
      cancelFrame,
    })

    batcher.queue([
      { type: 'position', id: 'a', position: { x: 10, y: 20 } },
    ])
    batcher.flush()
    expect(cancelFrame).toHaveBeenCalledWith(7)
    expect(apply).toHaveBeenCalledWith([
      { type: 'position', id: 'a', position: { x: 10, y: 20 } },
    ])
    callbacks[0]?.()
    expect(apply).toHaveBeenCalledOnce()
  })
})
