import { describe, expect, it } from 'vitest'
import type { AgentPlan } from '../../../domain/agent/plan'
import {
  applyUniformGenerationRatio,
  generationRatioProblems,
} from './agentGenerationConstraints'

function plan(): AgentPlan {
  return {
    summary: '五张电商主图',
    nodes: [
      {
        localId: 'a',
        type: 'generation',
        title: '白底主视觉',
        data: { prompt: '主图 A', ratio: '16:9' },
        order: 0,
      },
      {
        localId: 'b',
        type: 'generation',
        title: '切开截面',
        data: { prompt: '主图 B' },
        order: 1,
      },
      {
        localId: 'v',
        type: 'generation',
        title: '商品视频',
        data: { prompt: '短视频', mode: 'video', ratio: '9:16' },
        order: 2,
      },
      { localId: 'p', type: 'prompt', data: { text: '补充说明' }, order: 0 },
    ],
    edges: [],
  }
}

describe('Agent 统一输出比例', () => {
  it('★★ 显式统一比例会覆盖所有新建图片节点，视频与提示词节点不动', () => {
    const applied = applyUniformGenerationRatio(plan(), '1:1')
    expect(applied.changed).toBe(2)
    expect(
      applied.plan.nodes
        .filter((node) => node.type === 'generation')
        .map((node) => node.data.ratio),
    ).toEqual(['1:1', '1:1', '9:16'])
    expect(applied.plan.nodes.find((node) => node.localId === 'p')?.data).toEqual({
      text: '补充说明',
    })
  })

  it('★★ 生成前发现目标节点比例不一致会直接拒绝', () => {
    expect(
      generationRatioProblems(
        [
          {
            id: 'g1',
            type: 'generation',
            title: '白底主视觉',
            data: { ratio: '16:9' },
          },
          {
            id: 'g2',
            type: 'generation',
            title: '截面图',
            data: { ratio: '1:1' },
          },
        ],
        ['g1', 'g2'],
        '1:1',
      ),
    ).toEqual([expect.stringContaining('当前比例是 16:9')])
  })
})
