import { describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot } from '../model/node'
import { excludedNodeIds } from './excludedNodes'

function node(over: Partial<NodeSnapshot> & { id: string; type: NodeSnapshot['type'] }): NodeSnapshot {
  return {
    projectId: 'p1',
    parentId: null,
    x: 0,
    y: 0,
    w: 200,
    h: 160,
    title: over.id,
    disabled: false,
    data: {},
    ...over,
  } as NodeSnapshot
}

const graph = (nodes: NodeSnapshot[]): GraphSnapshot => ({ projectId: 'p1', nodes, edges: [] })

describe('excludedNodeIds · 画布「未参与」集合（#1160）', () => {
  it('下游把某个上游的眼睛关了 → 那个上游进集合', () => {
    const g = graph([
      node({ id: 'down', type: 'generation', data: { upstreamHidden: ['up'] } as never }),
      node({ id: 'up', type: 'generation' }),
    ])
    expect([...excludedNodeIds(g)]).toEqual(['up'])
  })

  it('容器把子节点关了 → 子节点进集合', () => {
    const g = graph([
      node({ id: 'grp', type: 'group', data: { childIds: ['c1'], hiddenIds: ['c1'] } as never }),
      node({ id: 'c1', type: 'generation', parentId: 'grp' }),
    ])
    expect([...excludedNodeIds(g)]).toEqual(['c1'])
  })

  /**
   * 用户 2026-11-19 看图一后纠正：**自家缩略图被隐藏，节点也要置灰**
   * （生成 / 提示词节点把自己的 id 写进 `hiddenIds`）。
   */
  it('★ 生成节点隐藏自家素材 → 该节点进集合（自家素材也算未参与）', () => {
    const g = graph([node({ id: 'gen', type: 'generation', data: { hiddenIds: ['gen'] } as never })])
    expect([...excludedNodeIds(g)]).toEqual(['gen'])
  })

  it('多个消费者：任意一个隐藏它就算（B1）', () => {
    const g = graph([
      node({ id: 'a', type: 'generation', data: { upstreamHidden: ['up'] } as never }),
      node({ id: 'b', type: 'generation', data: { upstreamHidden: [] } as never }),
      node({ id: 'up', type: 'generation' }),
    ])
    expect(excludedNodeIds(g).has('up')).toBe(true)
  })
})
