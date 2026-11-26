import { describe, expect, it } from 'vitest'
import type { AgentPlan } from './plan'
import {
  ecommercePlanProblems,
  isEcommerceImageTask,
  requiresEcommerceTypography,
} from './ecommerceIntent'

function plan(
  prompts: readonly string[],
  edges: AgentPlan['edges'] = [],
): AgentPlan {
  return {
    summary: '电商主图套图',
    nodes: prompts.map((prompt, index) => ({
      localId: `g${index + 1}`,
      type: 'generation',
      title: index === 0 ? '首屏 KV' : `卖点图 ${index + 1}`,
      data: { prompt, ratio: '1:1' },
      order: index,
    })),
    edges,
  }
}

describe('电商意图', () => {
  it('识别电商图片任务与显式文字排版要求', () => {
    expect(isEcommerceImageTask('帮我做淘宝五张月饼主图和详情页')).toBe(true)
    expect(isEcommerceImageTask('解释一下淘宝详情页怎么上传')).toBe(false)
    expect(requiresEcommerceTypography('主图统一 1:1 并带文字排版')).toBe(true)
  })

  it('电商套图必须共享锚点', () => {
    expect(ecommercePlanProblems(plan([
      '首屏 KV，主标题：月满楼，副标题：双黄白莲蓉',
      '卖点图，主标题：古法饼皮，字体：黑体',
    ]), { typographyRequired: true })).toEqual([
      expect.stringContaining('没有共同锚点'),
    ])
  })

  it('共用首屏锚点后通过；显式排版时非白底节点不能漏字', () => {
    expect(ecommercePlanProblems(plan([
      '首屏 KV，主标题：月满楼，副标题：双黄白莲蓉',
      '卖点图，主标题：古法饼皮，字体：黑体',
    ], [{ source: 'g1', target: 'g2' }]), { typographyRequired: true })).toEqual([])
    expect(ecommercePlanProblems(plan([
      '首屏 KV，主标题：月满楼',
      '卖点图，只展示流心特写',
    ], [{ source: 'g1', target: 'g2' }]), { typographyRequired: true })).toEqual([
      expect.stringContaining('没有写清文字层级'),
    ])
  })

  it('只共享提示词节点不算视觉锚点', () => {
    const sharedPrompt: AgentPlan = {
      summary: '电商套图',
      nodes: [
        { localId: 'p', type: 'prompt', data: { text: '共用说明' }, order: 0 },
        {
          localId: 'g1',
          type: 'generation',
          title: '首屏 KV',
          data: { prompt: '主标题：月满楼' },
          order: 1,
        },
        {
          localId: 'g2',
          type: 'generation',
          title: '卖点图',
          data: { prompt: '主标题：古法饼皮' },
          order: 2,
        },
      ],
      edges: [
        { source: 'p', target: 'g1' },
        { source: 'p', target: 'g2' },
      ],
    }
    expect(ecommercePlanProblems(sharedPrompt, { typographyRequired: true })).toEqual([
      expect.stringContaining('没有共同锚点'),
    ])
  })
})
