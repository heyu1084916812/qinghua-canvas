/**
 * Agent 过程中可被用户看见、可折叠回看的一类阶段。
 *
 * 这是**展示词表**，不是模型协议字段：阶段事件只能由真实工具、路由、技能加载、
 * 参考筛选与生成结果派生，不能把它当作自由文本塞进模型上下文，也不能用它伪造
 * 模型没有返回的思考内容。
 */
export const AGENT_PHASES = [
  'understand',
  'align',
  'skillLoaded',
  'research',
  'referenceAnalysis',
  'plan',
  'generate',
  'review',
  'iterate',
  'done',
] as const

export type AgentPhase = (typeof AGENT_PHASES)[number]

export interface AgentPhaseEvent {
  phase: AgentPhase
  title: string
  detail?: string
  /** 由真实结果写入，例如技能名、命中的参考数、模型名；没有证据就不写。 */
  evidence?: readonly string[]
}

export function isAgentPhase(value: unknown): value is AgentPhase {
  return typeof value === 'string' && (AGENT_PHASES as readonly string[]).includes(value)
}

export function agentPhaseTitle(phase: AgentPhase): string {
  const titles: Record<AgentPhase, string> = {
    understand: '理解需求',
    align: '对齐信息',
    skillLoaded: '技能加载完成',
    research: '调研完成',
    referenceAnalysis: '参考分析完成',
    plan: '交付物已规划',
    generate: '生成完成',
    review: '验收完成',
    iterate: '迭代完成',
    done: '本轮完成',
  }
  return titles[phase]
}

/** 折叠态只显示阶段标题与可核实的证据数量，不展开过程正文。 */
export function agentPhaseCollapsedSummary(event: AgentPhaseEvent): string {
  const evidence = event.evidence?.filter(Boolean) ?? []
  const suffix = evidence.length > 0 ? ` · ${evidence.length} 项依据` : ''
  return `${agentPhaseTitle(event.phase)}${suffix}`
}

/**
 * 已登记工具 → 用户可理解的阶段。返回空表示「这一步没有阶段语义」，
 * 调用方必须保留普通工具步骤，不能用猜测或默认阶段伪装成新流程。
 */
export function agentPhaseForTool(tool: string): AgentPhase | undefined {
  const phases: Record<string, AgentPhase> = {
    readGraph: 'align',
    readAsset: 'align',
    readResult: 'align',
    curateReferences: 'referenceAnalysis',
    researchDesign: 'research',
    readPage: 'research',
    visualReview: 'review',
    proposeTaskPlan: 'plan',
    updateTaskStep: 'plan',
    requestTaskConfirmation: 'plan',
    applyPlan: 'plan',
    runNode: 'generate',
    runFrom: 'generate',
    compareNodes: 'review',
    sliceImage: 'iterate',
    splitGrid: 'iterate',
    updateNode: 'iterate',
  }
  return phases[tool]
}
