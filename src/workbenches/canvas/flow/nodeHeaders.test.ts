import { describe, expect, it } from 'vitest'
import {
  nodeHeaderLabels,
  nodeHeadersInView,
  sameHeaderLabels,
  type NodeHeaderLabel,
} from './nodeHeaders'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'

function node(overrides: Partial<NodeSnapshot>): NodeSnapshot {
  return {
    id: 'node-1',
    projectId: 'project-1',
    type: 'generation',
    title: '结果图',
    x: 0,
    y: 0,
    w: 240,
    h: 192,
    parentId: null,
    data: {},
    disabled: false,
    ...overrides,
  } as NodeSnapshot
}

describe('node header overlay', () => {
  it('builds labels only for top-level nodes and keeps pixel text on the right', () => {
    const labels = nodeHeaderLabels([
      node({
        id: 'batch',
        type: 'batch',
        title: '批量',
        w: 456,
        h: 200,
        data: { childIds: ['child'] } as never,
      }),
      node({
        id: 'top',
        title: '把手套全改成黄色',
        data: { assetHash: 'asset-1', naturalSize: { width: 1087, height: 1446 } } as never,
      }),
      node({ id: 'child', parentId: 'batch' }),
      node({ id: 'prompt', type: 'prompt', title: '提示词' }),
    ])

    expect(labels).toEqual([
      {
        id: 'batch',
        title: '批量',
        pixels: '',
        x: 0,
        y: 0,
        w: 456,
      },
      {
        id: 'top',
        title: '把手套全改成黄色',
        pixels: '1087×1446',
        x: 0,
        y: 0,
        w: 240,
      },
      {
        id: 'child',
        title: '结果图',
        pixels: '',
        x: 20,
        y: 20,
        w: 200,
      },
      {
        id: 'prompt',
        title: '提示词',
        pixels: '',
        x: 0,
        y: 0,
        w: 240,
      },
    ])
  })

  it('culls headers outside the viewport while keeping the row above each node', () => {
    const labels: NodeHeaderLabel[] = [
      { id: 'visible', title: '可见', pixels: '', x: 100, y: 100, w: 240 },
      { id: 'far', title: '很远', pixels: '', x: 2000, y: 2000, w: 240 },
    ]

    expect(nodeHeadersInView(labels, { x: 0, y: 0, zoom: 1 }, { w: 800, h: 600 })).toEqual([
      labels[0],
    ])
  })

  it('only rerenders when label content or geometry really changes', () => {
    const first: NodeHeaderLabel[] = [
      { id: 'a', title: 'A', pixels: '10×10', x: 0, y: 0, w: 240 },
    ]
    const same = first.map((label) => ({ ...label }))
    const changed = [{ ...first[0], title: 'B' }]

    expect(sameHeaderLabels(first, same)).toBe(true)
    expect(sameHeaderLabels(first, changed)).toBe(false)
  })
})
