import { beforeAll, describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { coarseEdgePaths, viewportEdgePaths } from './coarseEdges'
import type { CoarseEdgePath } from './coarseEdges'

const node = (id: string, x: number, parentId: string | null = null): NodeSnapshot =>
  ({
    id,
    projectId: 'p1',
    type: 'generation',
    parentId,
    x,
    y: 0,
    w: 240,
    h: 192,
    title: id,
    disabled: false,
    data: {},
  }) as unknown as NodeSnapshot

describe('coarseEdgePaths', () => {
  beforeAll(() => registerAllSpecs())

  it('builds world-space paths for main edges and leaves child edges to their own layer', () => {
    const graph: GraphSnapshot = {
      projectId: 'p1',
      nodes: [node('group', 0), node('child', 20, 'group'), node('top', 500)],
      edges: [
        {
          id: 'main',
          projectId: 'p1',
          source: 'group',
          target: 'top',
          sourcePort: 'output',
          targetPort: 'input',
        },
        {
          id: 'child-edge',
          projectId: 'p1',
          source: 'child',
          target: 'top',
          sourcePort: 'output',
          targetPort: 'input',
        },
      ],
    }

    const paths = coarseEdgePaths(graph, ['top'], ['main'])
    expect(paths.map((path) => path.id)).toEqual(['main'])
    expect(paths[0]).toMatchObject({
      source: 'group',
      target: 'top',
      related: true,
      selected: true,
    })
    // Same solver as QhEdge (RF getBezierPath): switching layers never changes the curve
    expect(paths[0]?.d).toBe('M240,96 C370,96 370,96 500,96')
    expect(paths[0]?.d).toMatch(/^M-?\d[\d.]*,-?\d[\d.]* C/)
  })

  it('merges inactive edges while keeping highlighted edges separate', () => {
    const path = (
      id: string,
      d: string,
      related = false,
      selected = false,
    ): CoarseEdgePath => ({
      id,
      source: id,
      target: `${id}-target`,
      sourcePort: 'output',
      targetPort: 'input',
      d,
      related,
      selected,
    })
    const paths = [
      path('plain-a', 'M 0 0 C 1 0 2 0 3 0'),
      path('selected', 'M 3 0 C 4 0 5 0 6 0', false, true),
      path('related', 'M 6 0 C 7 0 8 0 9 0', true),
      path('plain-b', 'M 9 0 C 10 0 11 0 12 0'),
    ]
    const merged = viewportEdgePaths(paths)
    expect(merged.base).toBe('M 0 0 C 1 0 2 0 3 0 M 9 0 C 10 0 11 0 12 0')
    expect(merged.active.map((path) => path.id)).toEqual(['selected', 'related'])
  })
})
