import type { FlowNodeChangeLike } from './flowSurfaceChangeCoordinator'

export interface FlowNodePositionHost {
  querySelector(selector: string): { style: { transform: string } } | null
}

function nodeSelector(id: string): string {
  return `.react-flow__node[data-id="${id.replace(/["\\]/g, '\\$&')}"]`
}

/**
 * React Flow gives us the pointer-frame position before the graph projection
 * commits. Applying that transform immediately removes the one-frame visual
 * delay while the store update is still coalesced.
 */
export function writeFlowNodeDomPositions(
  host: FlowNodePositionHost,
  changes: readonly FlowNodeChangeLike[],
): number {
  let written = 0
  for (const change of changes) {
    if (change.type !== 'position' || !change.id || !change.position) continue
    const element = host.querySelector(nodeSelector(change.id))
    if (!element) continue
    element.style.transform =
      `translate(${change.position.x}px, ${change.position.y}px)`
    written += 1
  }
  return written
}
