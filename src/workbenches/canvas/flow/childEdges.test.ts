import { beforeAll, describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { childEdgeIdSet, childEdgePaths } from './childEdges'

const node = (
  id: string,
  parentId: string | null = null,
  type = 'generation',
): NodeSnapshot =>
  ({
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
  }) as unknown as NodeSnapshot

const graphOf = (
  nodes: NodeSnapshot[],
  edges: GraphSnapshot['edges'],
): GraphSnapshot => ({ projectId: 'p1', nodes, edges })

describe('childEdges', () => {
  beforeAll(() => registerAllSpecs())

  it('indexes only edges touching a container child', () => {
    const graph = graphOf(
      [node('group', null, 'group'), node('child', 'group'), node('top')],
      [
        {
          id: 'e-child',
          projectId: 'p1',
          source: 'child',
          target: 'top',
          sourcePort: 'output',
          targetPort: 'input',
        },
        {
          id: 'e-top',
          projectId: 'p1',
          source: 'top',
          target: 'group',
          sourcePort: 'output',
          targetPort: 'input',
        },
      ],
    )

    expect([...childEdgeIdSet(graph)]).toEqual(['e-child'])
  })

  it('reuses one node index while producing all child-edge paths', () => {
    const graph = graphOf(
      [node('group', null, 'group'), node('child', 'group'), node('top')],
      [
        {
          id: 'e-child',
          projectId: 'p1',
          source: 'child',
          target: 'top',
          sourcePort: 'output',
          targetPort: 'input',
        },
        {
          id: 'e-top',
          projectId: 'p1',
          source: 'top',
          target: 'group',
          sourcePort: 'output',
          targetPort: 'input',
        },
      ],
    )

    const paths = childEdgePaths(graph, { x: 0, y: 0, zoom: 1 }, ['child'])
    expect(paths.map((path) => path.id)).toEqual(['e-child'])
    expect(paths[0]?.related).toBe(true)
    expect(paths[0]?.d).toMatch(/^M /)
  })
})
