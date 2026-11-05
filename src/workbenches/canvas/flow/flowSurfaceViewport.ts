/** FlowSurface 的视口同步与细节模式规则：不拥有 store 或 React Flow 实例。 */
import type { FlowViewport } from './viewportBridge'

export const VIEWPORT_EPSILON = 0.01

export function sameFlowViewport(a: FlowViewport, b: FlowViewport): boolean {
  return (
    Math.abs(a.x - b.x) < VIEWPORT_EPSILON &&
    Math.abs(a.y - b.y) < VIEWPORT_EPSILON &&
    Math.abs(a.zoom - b.zoom) < VIEWPORT_EPSILON
  )
}

export function shouldSyncStoreViewport(
  current: FlowViewport,
  next: FlowViewport,
): boolean {
  return !sameFlowViewport(current, next)
}

export const FLOW_NODE_TYPES = { qh: 'qh', coarse: 'coarse' } as const
export const FLOW_EDGE_TYPES = { qh: 'qh', coarse: 'coarse' } as const
export const FLOW_EDGE_OPTIONS = { type: 'default' } as const
