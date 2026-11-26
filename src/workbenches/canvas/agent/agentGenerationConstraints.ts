import type { AgentPlan } from '../../../domain/agent/plan'
import { asRecord } from './canvasReadTools'

function normalizedRatio(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/：/g, ':').slice(0, 20)
    : ''
}

/**
 * 用户明确要求整组统一的图片比例时，在计划落地前覆盖所有新建生成节点。
 *
 * 节点漏写比例时会继承渠道默认配方，真机上正是因此出现“嘴上说统一 1:1，
 * 实际某张继承了旧比例”。这里不再让模型漏字段决定结果。
 */
export function applyUniformGenerationRatio(
  plan: AgentPlan,
  ratio: string | undefined,
): { plan: AgentPlan; changed: number } {
  const expected = normalizedRatio(ratio)
  if (!expected) return { plan, changed: 0 }
  let changed = 0
  const nodes = plan.nodes.map((node) => {
    if (node.type !== 'generation') return node
    if (node.data.mode === 'video') return node
    const current = normalizedRatio(node.data.ratio)
    if (current === expected) return node
    changed += 1
    return {
      ...node,
      data: { ...node.data, ratio: expected },
    }
  })
  return {
    plan: changed > 0 ? { ...plan, nodes } : plan,
    changed,
  }
}

/** 生成前兜底：显式比例与目标生成节点不一致时，禁止开始付费请求。 */
export function generationRatioProblems(
  nodes: readonly {
    id: string
    type: string
    title?: string
    data?: unknown
  }[],
  nodeIds: readonly string[],
  ratio: string | undefined,
): string[] {
  const expected = normalizedRatio(ratio)
  if (!expected) return []
  const selected = new Set(nodeIds)
  return nodes.flatMap((node) => {
    if (!selected.has(node.id) || node.type !== 'generation') return []
    const data = asRecord(node.data)
    if (data.mode === 'video') return []
    const actual = normalizedRatio(data.ratio)
    if (actual === expected) return []
    return [
      `生成节点「${node.title?.trim() || node.id}」当前比例是 ${actual || '(空，会继承默认配方)'}，` +
        `但本轮要求整组统一为 ${expected}。请先把节点比例改为 ${expected}，再开始生成。`,
    ]
  })
}
