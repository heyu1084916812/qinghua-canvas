import type { AgentNodeType, AgentPlan } from '../../../domain/agent/plan'

export interface AgentPlanResolvedNode {
  localId: string
  nodeId: string
}

/**
 * applyPlan 落地后的模型自检：生成节点不能误写对话模型；
 * 用户本轮明确选择的模型也必须真的写进去。
 */
export function generationLandingProblems(input: {
  plan: AgentPlan
  resolvedNodes: readonly AgentPlanResolvedNode[]
  graphNodes: readonly { id: string; data?: unknown }[]
  explicitFor?: (
    type: AgentNodeType,
    node: AgentPlan['nodes'][number],
  ) => { model: string } | undefined
  categoryOfModel?: (model: string) => 'image' | 'video' | 'chat' | undefined
}): string[] {
  const attachedLocalIds = new Set(
    (input.plan.attach ?? []).map((item) => item.localId),
  )
  return input.plan.nodes.flatMap((node) => {
    if (node.type !== 'generation' || attachedLocalIds.has(node.localId)) return []
    const expected = input.explicitFor?.(node.type, node)
    const resolved = input.resolvedNodes.find(
      (item) => item.localId === node.localId,
    )
    const actualData = resolved
      ? input.graphNodes.find((item) => item.id === resolved.nodeId)?.data as
          | { model?: unknown }
          | undefined
      : undefined
    const actualModel = actualData?.model
    const problems: string[] = []
    if (
      typeof actualModel === 'string' &&
      input.categoryOfModel?.(actualModel) === 'chat'
    ) {
      problems.push(
        `节点「${node.title ?? node.localId}」是生成节点，却写入了对话模型 ${actualModel}。`,
      )
    }
    if (
      expected &&
      !(typeof actualModel === 'string' && actualModel === expected.model)
    ) {
      problems.push(
        `节点「${node.title ?? node.localId}」明确要求使用 ${expected.model}，` +
          `实际写入的是 ${typeof actualModel === 'string' && actualModel ? actualModel : '(空)'}。`,
      )
    }
    return problems
  })
}
