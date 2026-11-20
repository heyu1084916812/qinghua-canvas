/**
 * Agent 生图请求的六类流程策略（#989）。这是给模型的流程事实，不是 UI 模式：
 * 由用户当前请求、引用、套件和任务状态确定，不能凭空声称已经执行了某一步。
 */
export const AGENT_GENERATION_FLOWS = [
  'direct',
  'reference',
  'brandSeries',
  'research',
  'iterate',
  'suite',
] as const
export type AgentGenerationFlow = (typeof AGENT_GENERATION_FLOWS)[number]

export interface AgentGenerationFlowSignals {
  text: string
  requestMode: 'simple_generate' | 'reference_edit' | 'design_research' | 'canvas_operation' | 'complex_plan'
  hasReference: boolean
  hasKit: boolean
  continued: boolean
  hasTaskPlan: boolean
}

const LABELS: Record<AgentGenerationFlow, string> = {
  direct: '简单直接生成',
  reference: '参考驱动生成',
  brandSeries: '品牌一致性系列',
  research: '调研与搜索参考',
  iterate: '多轮迭代优化',
  suite: '长流程套装交付',
}

const SERIES = /系列|同款|同系列|延展|横版|竖版|多尺寸|配套|品牌(?:视觉|套件)|vi\b|视觉规范/i
const RESEARCH = /联网|上网|搜索|搜一下|查一下|调研|灵感|参考案例|竞品/i
const ITERATE = /再来|再出|重画|重绘|改成|换成|优化|调整|微调|保持|大一点|小一点|更亮|更暗|上一张|刚才|继续/i
const SUITE = /整套|套装|全案|详情页|系列海报|多尺寸\s*kv|一整套|批量/i

export function agentGenerationFlowLabel(flow: AgentGenerationFlow): string {
  return LABELS[flow]
}

export function classifyAgentGenerationFlow(input: AgentGenerationFlowSignals): AgentGenerationFlow {
  const text = input.text.replace(/\s+/g, '')
  if (SUITE.test(text) || (input.requestMode === 'complex_plan' && input.hasTaskPlan && /物料|页面|海报|kv/i.test(text))) return 'suite'
  if (RESEARCH.test(text) || input.requestMode === 'design_research') return 'research'
  if (input.hasKit && SERIES.test(text)) return 'brandSeries'
  if (input.hasReference || input.requestMode === 'reference_edit') return 'reference'
  if (ITERATE.test(text) || input.continued) return 'iterate'
  return 'direct'
}
