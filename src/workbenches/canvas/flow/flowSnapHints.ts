import type { FlowSnapHints } from './flowSurfaceChangeCoordinator'

export function sameFlowSnapHints(
  left: FlowSnapHints | null,
  right: FlowSnapHints | null,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  if (left.guides.length !== right.guides.length || left.gaps.length !== right.gaps.length) {
    return false
  }
  return (
    left.guides.every((guide, index) => {
      const other = right.guides[index]
      return (
        other?.axis === guide.axis &&
        other.at === guide.at &&
        other.from === guide.from &&
        other.to === guide.to
      )
    }) &&
    left.gaps.every((gap, index) => {
      const other = right.gaps[index]
      return (
        other?.axis === gap.axis &&
        other.value === gap.value &&
        other.x === gap.x &&
        other.y === gap.y
      )
    })
  )
}
