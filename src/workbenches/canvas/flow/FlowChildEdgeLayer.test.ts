import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'

const fixture = vi.hoisted(() => {
  const node = (id: string, parentId: string | null = null, type = 'generation', x = 0, y = 0) => ({
    id,
    projectId: 'p1',
    type,
    parentId,
    x,
    y,
    w: 240,
    h: 192,
    title: id,
    disabled: false,
    data: {},
  })
  const makeGraph = (childX = 0, childY = 0): GraphSnapshot =>
    ({
      projectId: 'p1',
      nodes: [
        node('group', null, 'group', 0, 0),
        node('child', 'group', 'generation', childX, childY),
        node('external', null, 'generation', 500, 0),
      ],
      edges: [
        {
          id: 'child-edge',
          projectId: 'p1',
          source: 'child',
          target: 'external',
          sourcePort: 'output',
          targetPort: 'input',
        },
      ],
    }) as GraphSnapshot
  return {
    makeGraph,
    graph: makeGraph(0, 0),
    draggingId: null as string | null,
  }
})

vi.mock('../storeContext', () => ({
  useGraph: () => fixture.graph,
  useSelection: () => [],
  useViewportState: () => ({ x: 0, y: 0, zoom: 1 }),
  useCanvasStore: () => ({ dispatch: vi.fn(), getDraggingId: () => fixture.draggingId }),
}))

import { FlowChildEdgeLayer } from './FlowChildEdgeLayer'

describe('FlowChildEdgeLayer anchors', () => {
  beforeAll(() => registerAllSpecs())
  afterEach(() => {
    fixture.graph = fixture.makeGraph(0, 0)
    fixture.draggingId = null
  })

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

  it('follows live graph updates when dragging a child node inside a group, but freezes for top-level drag', () => {
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(createElement(FlowChildEdgeLayer))
    })
    const pathD = () =>
      renderer.root.find((node) => node.type === 'path' && node.props['data-child-edge'] === 'child-edge')
        .props.d as string

    const initialD = pathD()

    // 1. 拖动分组内子节点：不冻结，连线必须立刻跟随新坐标
    fixture.draggingId = 'child'
    fixture.graph = fixture.makeGraph(120, 80)
    act(() => {
      renderer.update(createElement(FlowChildEdgeLayer))
    })
    const movedChildD = pathD()
    expect(movedChildD).not.toBe(initialD)

    // 2. 松手后改为拖动顶层分组容器：保持冻结，由 DOM follower 接管
    fixture.draggingId = null
    act(() => {
      renderer.update(createElement(FlowChildEdgeLayer))
    })
    fixture.draggingId = 'group'
    fixture.graph = fixture.makeGraph(240, 160)
    act(() => {
      renderer.update(createElement(FlowChildEdgeLayer))
    })
    expect(pathD()).toBe(movedChildD)

    act(() => {
      renderer.unmount()
    })
  })
})
