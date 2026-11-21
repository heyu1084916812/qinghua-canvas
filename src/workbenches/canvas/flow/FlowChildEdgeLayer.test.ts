import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'

const fixture = vi.hoisted(() => {
  const node = (id: string, parentId: string | null = null, type = 'generation') => ({
    id,
    projectId: 'p1',
    type,
    parentId,
    x: 0,
    y: 0,
    w: 240,
    h: 192,
    title: id,
    disabled: false,
    data: {},
  })
  return {
    graph: {
      projectId: 'p1',
      nodes: [
        node('group', null, 'group'),
        node('child', 'group'),
        node('external'),
      ],
      edges: [{
        id: 'child-edge',
        projectId: 'p1',
        source: 'child',
        target: 'external',
        sourcePort: 'output',
        targetPort: 'input',
      }],
    } as GraphSnapshot,
  }
})

vi.mock('../storeContext', () => ({
  useGraph: () => fixture.graph,
  useSelection: () => [],
  useViewportState: () => ({ x: 0, y: 0, zoom: 1 }),
  useCanvasStore: () => ({ dispatch: vi.fn() }),
}))

import { FlowChildEdgeLayer } from './FlowChildEdgeLayer'

describe('FlowChildEdgeLayer anchors', () => {
  beforeAll(() => registerAllSpecs())

  it('puts the real edge id on the visual path used by the knife', () => {
    const html = renderToStaticMarkup(createElement(FlowChildEdgeLayer))
    expect(html).toContain('data-edge="child-edge"')
    expect(html).toContain('data-child-edge="child-edge"')
  })

  it('puts the same id on the transparent hit path', () => {
    const html = renderToStaticMarkup(createElement(FlowChildEdgeLayer, { hitOnly: true }))
    expect(html).toContain('data-child-edge-hit="child-edge"')
    expect(html).not.toContain('data-edge=')
  })
})
