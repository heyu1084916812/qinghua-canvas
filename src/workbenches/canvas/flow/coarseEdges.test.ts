import { beforeAll, describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { coarseEdgePaths } from './coarseEdges'

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
    expect(paths[0]?.d).toMatch(/^M /)
  })
})
