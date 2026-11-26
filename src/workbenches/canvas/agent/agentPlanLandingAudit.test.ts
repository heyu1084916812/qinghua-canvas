import { describe, expect, it } from 'vitest'
import type { AgentPlan } from '../../../domain/agent/plan'
import { generationLandingProblems } from './agentPlanLandingAudit'

const plan: AgentPlan = {
  summary: '一张主图',
  nodes: [
    {
      localId: 'g',
      type: 'generation',
      title: '主图',
      data: { prompt: '月饼主图' },
      order: 0,
    },
  ],
  edges: [],
}

describe('Agent 计划落地自检', () => {
  it('拒绝生成节点误写对话模型', () => {
    expect(
      generationLandingProblems({
        plan,
        resolvedNodes: [{ localId: 'g', nodeId: 'n1' }],
        graphNodes: [{ id: 'n1', data: { model: 'Deepseek 4.1 Flash' } }],
        categoryOfModel: () => 'chat',
      }).join('\n'),
    ).toContain('却写入了对话模型')
  })

  it('明确模型没有真正写入时拒绝', () => {
    expect(
      generationLandingProblems({
        plan,
        resolvedNodes: [{ localId: 'g', nodeId: 'n1' }],
        graphNodes: [{ id: 'n1', data: { model: 'GPT Image 2' } }],
        explicitFor: () => ({ model: 'Nano Banana 2.1' }),
        categoryOfModel: () => 'image',
      }).join('\n'),
    ).toContain('明确要求使用 Nano Banana 2.1')
  })
})
