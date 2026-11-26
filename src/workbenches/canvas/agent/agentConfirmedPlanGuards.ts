import type { AgentPlan } from '../../../domain/agent/plan'
import { ecommercePlanProblems } from '../../../domain/agent/ecommerceIntent'
import { applyUniformGenerationRatio } from './agentGenerationConstraints'

export interface ConfirmedPlanConstraints {
  uniformImageRatio?: string
  ecommerceArtDirection?: boolean
  ecommerceTypographyRequired?: boolean
  referenceAnalysisBlockedIds?: readonly string[]
}

export function referenceAnalysisBlockedProblems(
  tool: 'applyPlan' | 'runNode' | 'runFrom',
  ctx: ConfirmedPlanConstraints,
): string[] {
  const count = ctx.referenceAnalysisBlockedIds?.length ?? 0
  if (count === 0) return []
  if (tool === 'applyPlan') {
    return [
      `有 ${count} 条显式参考没有完成自动分析，当前不能创建或运行工作流。`,
      '请先重新分析参考，或由用户明确回复「跳过参考分析继续」。',
    ]
  }
  return [
    `显式参考分析尚未完成，不能${tool === 'runNode' ? '开始生成' : '运行下游链'}。`,
    '请先重试参考分析，或明确跳过。',
  ]
}

export function guardGenerationPlan(
  plan: AgentPlan,
  ctx: ConfirmedPlanConstraints,
): { plan: AgentPlan; notes: string[]; problems: string[] } {
  const ratio = applyUniformGenerationRatio(plan, ctx.uniformImageRatio)
  const ecommerce = ctx.ecommerceArtDirection
    ? ecommercePlanProblems(ratio.plan, {
        typographyRequired: ctx.ecommerceTypographyRequired === true,
      })
    : []
  const notes = ratio.changed > 0
    ? [`已按用户要求把 ${ratio.changed} 个生成节点统一为 ${ctx.uniformImageRatio}`]
    : []
  return { plan: ratio.plan, notes, problems: ecommerce }
}
