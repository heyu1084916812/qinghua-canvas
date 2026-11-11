import { describe, expect, it } from 'vitest'
import type { AgentPlan } from './plan'
import {
  allocateContextAssetsForNode,
  seriesAnchorProblems,
  seriesNodePurpose,
} from './seriesAnchors'

const gen = (localId: string, title: string, prompt = '') => ({
  localId,
  type: 'generation' as const,
  title,
  data: { prompt },
  order: 0,
})

describe('seriesNodePurpose', () => {
  it.each([
    [{ title: '奶茶店 Logo', data: {} }, 'logo'],
    [{ title: '杯身包装', data: {} }, 'packaging'],
    [{ title: '开业海报', data: { prompt: '海报左上角放 Logo' } }, 'poster'],
    [{ title: '', data: { prompt: '设计一个极简字标 logo，绿色' } }, 'logo'],
    [{ title: '方案 A', data: { prompt: '一只橘猫在窗台上晒太阳，角落印上品牌 logo' } }, 'other'],
  ])('%o → %s', (node, purpose) => {
    expect(seriesNodePurpose(node)).toBe(purpose)
  })
})

describe('allocateContextAssetsForNode（G4 按节点分配参考）', () => {
  const assets = [
    { hash: 'mood', role: 'reference', usage: 'style' },
    { hash: 'cup', role: 'reference', usage: 'subject' },
    { hash: 'layout', role: 'reference', usage: 'composition' },
    { hash: 'kit', role: 'reference' },
    { hash: 'logo', role: 'logo' },
  ]
  it('Logo 节点不拿产品主体和排版参考，Logo 排第一', () => {
    expect(allocateContextAssetsForNode('logo', assets).map((a) => a.hash))
      .toEqual(['logo', 'mood', 'kit'])
  })
  it('包装 / 海报 / 其他节点拿全部参考，Logo 排第一', () => {
    for (const purpose of ['packaging', 'poster', 'other'] as const) {
      expect(allocateContextAssetsForNode(purpose, assets).map((a) => a.hash))
        .toEqual(['logo', 'mood', 'cup', 'layout', 'kit'])
    }
  })
})

describe('seriesAnchorProblems（整套任务先定锚点）', () => {
  const nodes = [gen('logo', '奶茶店 Logo'), gen('pack', '杯身包装'), gen('poster', '开业海报')]
  it('Logo → 包装 → 海报串起来时通过', () => {
    const plan: Pick<AgentPlan, 'nodes' | 'edges'> = {
      nodes,
      edges: [
        { source: 'logo', target: 'pack' },
        { source: 'pack', target: 'poster' },
      ],
    }
    expect(seriesAnchorProblems(plan)).toEqual([])
  })
  it('后续节点没连到锚点时退回，并说明要补哪条连线', () => {
    const problems = seriesAnchorProblems({ nodes, edges: [{ source: 'logo', target: 'pack' }] })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('「开业海报」（海报）必须以「杯身包装」（包装）的结果为参考')
    expect(problems[0]).toContain('pack → poster')
  })
  it('只有一类节点（例如先定 Logo、或 4 张海报方向）不检查', () => {
    expect(seriesAnchorProblems({ nodes: [gen('a', '海报 A'), gen('b', '海报 B')], edges: [] }))
      .toEqual([])
    expect(seriesAnchorProblems({ nodes: [gen('logo', 'Logo')], edges: [] })).toEqual([])
  })
  it('没有包装时海报直接挂 Logo 也算；经由提示词节点的间接上游也算', () => {
    expect(seriesAnchorProblems({
      nodes: [gen('logo', 'Logo'), { localId: 'p', type: 'prompt', data: {}, order: 0 }, gen('poster', '海报')],
      edges: [{ source: 'logo', target: 'p' }, { source: 'p', target: 'poster' }],
    })).toEqual([])
  })
})
