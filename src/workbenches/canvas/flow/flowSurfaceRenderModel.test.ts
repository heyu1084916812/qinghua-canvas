import { describe, expect, it, vi } from 'vitest'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { NodeDerivedMaps } from '../useNodeDerivedMaps'
import {
  derivedPropsFor,
  flowEdgesFor,
  flowMeasurementKey,
  flowNodesFor,
  flowRunPresentationOf,
} from './flowSurfaceRenderModel'

function node(
  id: string,
  options: Partial<NodeSnapshot> & Pick<NodeSnapshot, 'type' | 'x' | 'y'>,
): NodeSnapshot {
  return {
    id,
    projectId: 'project',
    parentId: null,
    w: 100,
    h: 80,
    title: id,
    disabled: false,
    ...options,
  } as NodeSnapshot
}

function graph(nodes: NodeSnapshot[], edges: GraphSnapshot['edges'] = []): GraphSnapshot {
  return { projectId: 'project', nodes, edges }
}

function derived(): NodeDerivedMaps {
  return {
    upstreamHashes: new Map([['n1', ['hash']]]),
    upstreamPromptCounts: new Map([['n1', 2]]),
    runnableDownstream: new Map([['n1', true]]),
    upstreamImageInputs: new Map(),
    inputPortAssets: new Map(),
  }
}

describe('FlowSurface render model', () => {
  it('projects node run state without changing canceled semantics', () => {
    expect(flowRunPresentationOf(undefined)).toEqual({
      running: false,
      error: null,
      runMode: 'idle',
    })
    expect(flowRunPresentationOf({ kind: 'running' } as never)).toMatchObject({
      running: true,
      error: null,
      runMode: 'single',
    })
    expect(flowRunPresentationOf({ kind: 'canceled' } as never)).toMatchObject({
      running: false,
      runMode: 'single',
    })
  })

  it('maps graph-level derived values by node id', () => {
    expect(derivedPropsFor(derived(), 'n1')).toEqual({
      upstreamAssetHashes: ['hash'],
      upstreamPromptCount: 2,
      hasRunnableDownstream: true,
      upstreamImageInputs: undefined,
      inputPortAssets: undefined,
    })
  })

  it('projects top-level nodes and attaches container children only at container roots', () => {
    const child = node('child', { type: 'prompt', x: 0, y: 0, parentId: 'group' })
    const group = node('group', { type: 'group', x: 20, y: 30 })
    const top = node('top', { type: 'prompt', x: 200, y: 100 })
    const renderChild = vi.fn()
    const nodes = flowNodesFor({
      graph: graph([group, child, top]),
      selection: ['top'],
      detailMode: 'full',
      derived: derived(),
      childIndex: new Map([['group', [child]]]),
      nodeStateOf: () => undefined,
      emitFor: () => vi.fn(),
      resize: vi.fn(),
      renderChild,
    })
    expect(nodes.map((entry) => entry.id)).toEqual(['group', 'top'])
    expect(nodes[0].data.childNodes).toEqual([child])
    expect(nodes[0].data.renderChild).toBe(renderChild)
    expect(nodes[1].selected).toBe(true)
  })

  it('filters child edges and removes all RF edges in coarse mode', () => {
    const parent = node('parent', { type: 'group', x: 0, y: 0 })
    const child = node('child', { type: 'prompt', x: 0, y: 0, parentId: 'parent' })
    const top = node('top', { type: 'prompt', x: 200, y: 0 })
    const snapshot = graph(
      [parent, child, top],
      [
        { id: 'child-edge', source: 'child', target: 'top' },
        { id: 'top-edge', source: 'top', target: 'parent' },
      ] as GraphSnapshot['edges'],
    )
    const edges = flowEdgesFor({
      graph: snapshot,
      selection: ['top'],
      edgeSelection: ['top-edge'],
      detailMode: 'full',
      removeEdge: vi.fn(),
    })
    expect(edges.map((edge) => edge.id)).toEqual(['top-edge'])
    expect(edges[0].selected).toBe(true)
    expect(edges[0].data?.related).toBe(true)
    expect(
      flowEdgesFor({
        graph: snapshot,
        selection: [],
        edgeSelection: [],
        detailMode: 'coarse',
        removeEdge: vi.fn(),
      }),
    ).toEqual([])
  })

  it('measurement key changes when endpoints or ports change', () => {
    const base = graph(
      [node('a', { type: 'prompt', x: 0, y: 0 }), node('b', { type: 'prompt', x: 200, y: 0 })],
      [{ id: 'e', source: 'a', target: 'b', sourcePort: 'out', targetPort: 'in' }] as GraphSnapshot['edges'],
    )
    expect(flowMeasurementKey(base)).toContain('e:a>b:out>in')
    expect(
      flowMeasurementKey({
        ...base,
        edges: [{ ...base.edges[0], source: 'b', target: 'a' }],
      }),
    ).not.toBe(flowMeasurementKey(base))
  })
})
