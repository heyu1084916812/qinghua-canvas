import { describe, expect, it } from 'vitest'
import {
  FLOW_EDGE_OPTIONS,
  FLOW_EDGE_TYPES,
  FLOW_NODE_TYPES,
  sameFlowViewport,
  shouldSyncStoreViewport,
} from './flowSurfaceViewport'

describe('FlowSurface 视口同步', () => {
  it('小于 0.01 的抖动不触发双向同步', () => {
    const base = { x: 12, y: -8, zoom: 1.25 }
    expect(sameFlowViewport(base, { x: 12.004, y: -8.002, zoom: 1.251 })).toBe(true)
    expect(shouldSyncStoreViewport(base, { x: 12.004, y: -8.002, zoom: 1.251 })).toBe(false)
  })

  it('平移和缩放超过阈值都需要回写 store', () => {
    const base = { x: 12, y: -8, zoom: 1.25 }
    expect(shouldSyncStoreViewport(base, { ...base, x: 12.02 })).toBe(true)
    expect(shouldSyncStoreViewport(base, { ...base, zoom: 1.27 })).toBe(true)
  })

  it('节点 / 连线类型与默认边配置保持装配常量', () => {
    expect(FLOW_NODE_TYPES).toEqual({ qh: 'qh', coarse: 'coarse' })
    expect(FLOW_EDGE_TYPES).toEqual({ qh: 'qh', coarse: 'coarse' })
    expect(FLOW_EDGE_OPTIONS).toEqual({ type: 'default' })
  })
})
