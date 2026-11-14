import { describe, expect, it } from 'vitest'
import {
  buildWorkflowGraph,
  GRAPH_NODE_H,
  GRAPH_NODE_W,
  layoutWorkflowGraph,
  normalizeWorkflowGraph,
  workflowOutputNodeIds,
} from './workflowGraph'

/** 一个最小工作流：加载视频 → 超分 → 合并保存；其中「超分」吃上游视频 */
const prompt = {
  '10': { class_type: 'VHS_LoadVideo', _meta: { title: '源视频' }, inputs: { video: 'a.mp4', seek_seconds: 0 } },
  '20': { class_type: 'SeedVR2', _meta: { title: '超分' }, inputs: { strength: 0.8, video: ['10', 0] } },
  '30': { class_type: 'VHS_VideoCombine', inputs: { frame_rate: 30, images: ['20', 0], audio: ['10', 1] } },
}

describe('工作流节点图', () => {
  it('抽节点：标题优先 _meta.title，其次 class_type，再退节点号', () => {
    const graph = buildWorkflowGraph(prompt)
    expect(graph.nodes.map((node) => `${node.id}:${node.title}`)).toEqual([
      '10:源视频',
      '20:超分',
      '30:VHS_VideoCombine',
    ])
  })

  it('连线值不算参数、算边；自连与悬空边丢掉', () => {
    const graph = buildWorkflowGraph({
      ...prompt,
      '40': { class_type: 'Loop', inputs: { self: ['40', 0], ghost: ['999', 0], steps: 3 } },
    })
    expect(graph.nodes.find((node) => node.id === '20')!.fieldIds).toEqual(['20::strength'])
    expect(graph.nodes.find((node) => node.id === '40')!.fieldIds).toEqual(['40::steps'])
    expect(graph.edges).toEqual([
      { from: '10', to: '20' },
      { from: '20', to: '30' },
      { from: '10', to: '30' },
    ])
  })

  it('自动布局：按依赖分层，同一层同一列，宽高按格数算', () => {
    const graph = buildWorkflowGraph(prompt)
    const layout = layoutWorkflowGraph(graph)
    const at = (id: string) => layout.nodes.find((node) => node.id === id)!
    expect(at('10').depth).toBe(0)
    expect(at('20').depth).toBe(1)
    expect(at('30').depth).toBe(2)
    expect(at('10').x).toBe(0)
    expect(at('20').x).toBe(GRAPH_NODE_W + 56)
    /* 同层不同节点纵向错开，且不重叠 */
    expect(at('30').y).toBe(0)
    expect(layout.width).toBe(2 * (GRAPH_NODE_W + 56) + GRAPH_NODE_W)
    expect(layout.height).toBe(GRAPH_NODE_H)
  })

  it('成环也不会死循环，且能给出位置', () => {
    const cyclic = {
      '1': { class_type: 'A', inputs: { x: ['2', 0] } },
      '2': { class_type: 'B', inputs: { y: ['1', 0] } },
    }
    const layout = layoutWorkflowGraph(buildWorkflowGraph(cyclic))
    expect(layout.nodes).toHaveLength(2)
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true)
      expect(Number.isFinite(node.y)).toBe(true)
    }
  })

  it('输出节点 = 没有出边的节点', () => {
    expect(workflowOutputNodeIds(buildWorkflowGraph(prompt))).toEqual(['30'])
  })

  it('归一化：坏节点/悬空边丢掉；一个节点都没有时返回 undefined（老条目退回清单视图）', () => {
    expect(normalizeWorkflowGraph(null)).toBeUndefined()
    expect(normalizeWorkflowGraph({ nodes: [] })).toBeUndefined()
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: '1', title: 'A', classType: 'X', fieldIds: ['1::a', 3] },
        { id: '', title: 'bad' },
      ],
      edges: [{ from: '1', to: '2' }, 'nope'],
    })
    expect(graph).toEqual({ nodes: [{ id: '1', title: 'A', classType: 'X', fieldIds: ['1::a'] }], edges: [] })
  })
})
