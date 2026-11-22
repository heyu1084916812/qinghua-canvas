import type { FlowNodeChangeLike } from './flowSurfaceChangeCoordinator'

export interface FlowNodePositionBatcher {
  queue(changes: readonly FlowNodeChangeLike[]): void
  flush(): void
  cancel(): void
}

/**
 * Coalesces React Flow position changes to one graph commit per animation
 * frame. React Flow has already moved its internal node copy, so the visible
 * drag remains immediate while expensive store projections stay frame-bounded.
 */
export function createFlowNodePositionBatcher(input: {
  apply: (changes: FlowNodeChangeLike[]) => void
  requestFrame: (callback: () => void) => number
  cancelFrame: (id: number) => void
}): FlowNodePositionBatcher {
  let frame: number | null = null
  const pending = new Map<string, FlowNodeChangeLike>()

  const applyPending = () => {
    if (pending.size === 0) return
    const changes = [...pending.values()]
    pending.clear()
    input.apply(changes)
  }

  const flush = () => {
    if (frame !== null) input.cancelFrame(frame)
    frame = null
    applyPending()
  }

  return {
    queue(changes) {
      let queued = false
      for (const change of changes) {
        if (change.type !== 'position' || !change.id || !change.position) continue
        pending.set(change.id, change)
        queued = true
      }
      if (!queued || frame !== null) return
      frame = input.requestFrame(() => {
        frame = null
        applyPending()
      })
    },
    flush,
    cancel() {
      if (frame !== null) input.cancelFrame(frame)
      frame = null
      pending.clear()
    },
  }
}
