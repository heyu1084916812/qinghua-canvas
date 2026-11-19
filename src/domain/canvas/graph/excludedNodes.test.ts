import { describe, expect, it } from 'vitest'
import type { GraphSnapshot } from '../model/graph'
import type { Edge } from '../model/edge'
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

const graph = (nodes: NodeSnapshot[], edges: Edge[] = []): GraphSnapshot => ({
  projectId: 'p1',
  nodes,
  edges,
})

/** 一条 source → target 的连线（本模块只看两端，端口/顺序与判定无关） */
const edge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  projectId: 'p1',
  source,
  target,
})

describe('excludedNodeIds · 画布「未参与」集合（#1160）', () => {
  it('下游把某个上游的眼睛关了 → 那个上游进集合', () => {
    const g = graph(
      [
        node({ id: 'down', type: 'generation', data: { upstreamHidden: ['up'] } as never }),
        node({ id: 'up', type: 'generation' }),
      ],
      [edge('up', 'down')],
    )
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
   * 用户 2026-11-19 最终口径：自家缩略图被关掉，节点**也要**跟着置灰
   * （面板眼睛闭上、画布上那张图必须一起灰；再把眼睛打开要立刻恢复）。
   */
  it('★★ 生成节点隐藏自家素材 → 该节点进「未参与」集合', () => {
    const g = graph([
      node({ id: 'gen', type: 'generation', data: { hiddenIds: ['gen'], assetHash: 'h' } as never }),
    ])
    expect([...excludedNodeIds(g)]).toEqual(['gen'])
  })

  it('★ 取消隐藏（hiddenIds 清空）后立刻不在集合里', () => {
    const g = graph([
      node({ id: 'gen', type: 'generation', data: { hiddenIds: [], assetHash: 'h' } as never }),
    ])
    expect(excludedNodeIds(g).size).toBe(0)
  })

  it('多个消费者：任意一个隐藏它就算（B1）', () => {
    const g = graph(
      [
        node({ id: 'a', type: 'generation', data: { upstreamHidden: ['up'] } as never }),
        node({ id: 'b', type: 'generation', data: { upstreamHidden: [] } as never }),
        node({ id: 'up', type: 'generation' }),
      ],
      [edge('up', 'a'), edge('up', 'b')],
    )
    expect(excludedNodeIds(g).has('up')).toBe(true)
  })

  /**
   * ★★ 第六轮真机事故（`小猫钓鱼-02`）：承载节点（`__carrierOf`）的 `hiddenIds`
   * 里装的是**源节点 id**，两者之间没有任何连线。旧口径把源节点永久置灰，
   * 而源节点自己的面板里那只眼睛是"已启用"——用户没有任何地方能点回来。
   */
  it('★★ 生成节点的 hiddenIds 装的是别人（承载节点遗留）→ 不置灰任何人', () => {
    const g = graph([
      node({
        id: 'carrier',
        type: 'generation',
        data: { hiddenIds: ['source'], assetHash: 'h2', __carrierOf: 'source' } as never,
      }),
      node({ id: 'source', type: 'generation', data: { hiddenIds: [], assetHash: 'h1' } as never }),
    ])
    expect(excludedNodeIds(g).size).toBe(0)
  })

  /** 悬空 `upstreamHidden`（连线早删了）：面板里没有那张缩略图，也就不该置灰 */
  it('★★ 下游的 upstreamHidden 指向一个已断线的节点 → 不置灰', () => {
    const g = graph([
      node({ id: 'down', type: 'generation', data: { upstreamHidden: ['gone'] } as never }),
      node({ id: 'gone', type: 'generation', data: { assetHash: 'h' } as never }),
    ])
    expect(excludedNodeIds(g).size).toBe(0)
  })

  /** 素材被清空后，自家那枚眼睛就不存在了（`buildPanelModel` 只在有 assetHash 时给自家缩略图） */
  it('★ 自家 hiddenIds 还在但素材已清空 → 不置灰', () => {
    const g = graph([node({ id: 'gen', type: 'generation', data: { hiddenIds: ['gen'] } as never })])
    expect(excludedNodeIds(g).size).toBe(0)
  })

  /** 容器里的 id 已经不是它的子节点（拖出容器）：容器面板里没有这只眼睛 */
  it('★ 容器的 hiddenIds 指向非子节点 → 不置灰', () => {
    const g = graph([
      node({ id: 'grp', type: 'group', data: { childIds: ['kept'], hiddenIds: ['moved', 'kept'] } as never }),
      node({ id: 'kept', type: 'generation', parentId: 'grp' }),
      node({ id: 'moved', type: 'generation', parentId: null }),
    ])
    expect([...excludedNodeIds(g)]).toEqual(['kept'])
  })
})
