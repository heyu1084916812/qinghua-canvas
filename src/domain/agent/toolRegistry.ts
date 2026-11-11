export type AgentToolCategory = 'agent-internal' | 'canvas' | 'host-service'
export type AgentToolAccess = 'read' | 'write' | 'confirm'
export type AgentToolName =
  | 'readCapabilities'
  | 'readGraph'
  | 'readAsset'
  | 'curateReferences'
  | 'researchDesign'
  | 'readPage'
  | 'applyPlan'
  | 'updateNode'
  | 'proposeTaskPlan'
  | 'updateTaskStep'
  | 'requestTaskConfirmation'
  | 'askQuestions'
  | 'runNode'
  | 'runFrom'
  | 'readResult'
  | 'visualReview'
  | 'rememberMemory'
  | 'moveNodes'
  | 'resizeNodes'
  | 'deleteNodes'
  | 'arrangeNodes'
  | 'deleteEdges'
  | 'compareNodes'
  | 'sliceImage'
  | 'splitGrid'

export interface AgentToolDefinition {
  name: AgentToolName
  category: AgentToolCategory
  access: AgentToolAccess
  /** 说明该工具的副作用归属；用于设置页和未来的权限诊断。 */
  sideEffect: 'none' | 'canvas' | 'paid' | 'memory'
  /** 视觉验收后同一轮不得继续写画布或重新付费。 */
  terminalAfter?: boolean
}

/**
 * 自动模式可以静默完成的关键：它必须是明确的生成类动作（扣费），
 * 且不是删除 / 改已有节点这类破坏性画布操作，也不是记忆写入。
 * 靠“不是少数几个例外的都算”已经造成过误判；这里反向收口成白名单。
 */
const AUTO_CONFIRM_ALLOWED = new Set<AgentToolName>(['runNode', 'runFrom'])

export const AGENT_TOOL_GROUP_LABELS: Record<AgentToolCategory, string> = {
  'agent-internal': 'Agent 内部',
  canvas: '画布',
  'host-service': '宿主服务',
}

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  {
    name: 'readCapabilities',
    category: 'agent-internal',
    access: 'read',
    sideEffect: 'none',
  },
  { name: 'readGraph', category: 'canvas', access: 'read', sideEffect: 'none' },
  { name: 'readAsset', category: 'canvas', access: 'read', sideEffect: 'none' },
  { name: 'readResult', category: 'canvas', access: 'read', sideEffect: 'none' },
  {
    name: 'curateReferences',
    category: 'host-service',
    access: 'read',
    sideEffect: 'none',
  },
  {
    name: 'researchDesign',
    category: 'host-service',
    access: 'read',
    sideEffect: 'none',
  },
  {
    name: 'readPage',
    category: 'host-service',
    access: 'read',
    sideEffect: 'none',
  },
  {
    name: 'visualReview',
    category: 'canvas',
    access: 'read',
    sideEffect: 'none',
    terminalAfter: true,
  },
  { name: 'applyPlan', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'updateNode', category: 'canvas', access: 'confirm', sideEffect: 'canvas' },
  { name: 'moveNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'resizeNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'deleteNodes', category: 'canvas', access: 'confirm', sideEffect: 'canvas' },
  { name: 'arrangeNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'deleteEdges', category: 'canvas', access: 'confirm', sideEffect: 'canvas' },
  { name: 'compareNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'sliceImage', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'splitGrid', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'runNode', category: 'canvas', access: 'confirm', sideEffect: 'paid' },
  { name: 'runFrom', category: 'canvas', access: 'confirm', sideEffect: 'paid' },
  {
    name: 'proposeTaskPlan',
    category: 'agent-internal',
    access: 'confirm',
    sideEffect: 'none',
  },
  {
    name: 'updateTaskStep',
    category: 'agent-internal',
    access: 'write',
    sideEffect: 'none',
  },
  {
    name: 'requestTaskConfirmation',
    category: 'agent-internal',
    access: 'confirm',
    sideEffect: 'none',
  },
  {
    /** 问题卡：本回合到此结束，用户回答作为下一条消息（不是确认卡，见 questionCard.ts）。 */
    name: 'askQuestions',
    category: 'agent-internal',
    access: 'read',
    sideEffect: 'none',
  },
  {
    name: 'rememberMemory',
    category: 'host-service',
    access: 'confirm',
    sideEffect: 'memory',
  },
]

const BY_NAME = new Map(AGENT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]))

export const AGENT_READ_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.filter(
  (tool) => tool.access === 'read',
).map((tool) => tool.name)

export const AGENT_WRITE_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.filter(
  (tool) => tool.access === 'write',
).map((tool) => tool.name)

export const AGENT_CONFIRM_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.filter(
  (tool) => tool.access === 'confirm',
).map((tool) => tool.name)

export function agentToolDefinitionOf(name: string): AgentToolDefinition | null {
  return BY_NAME.get(name as AgentToolName) ?? null
}

export function isAgentToolName(name: string): name is AgentToolName {
  return BY_NAME.has(name as AgentToolName)
}

/** 自动模式下可以免人工确认的生成类动作白名单。 */
export function toolRunsGenerationInAutoMode(name: string): boolean {
  const definition = agentToolDefinitionOf(name)
  return definition?.access === 'confirm' && AUTO_CONFIRM_ALLOWED.has(definition.name)
}

export function agentToolsInCategory(category: AgentToolCategory): readonly AgentToolName[] {
  return AGENT_TOOL_DEFINITIONS.filter((tool) => tool.category === category).map(
    (tool) => tool.name,
  )
}

export function agentToolIdempotencyKey(input: {
  jobId: string
  stepId: string
  toolCallId: string
}): string {
  return `agent:${input.jobId}:${input.stepId}:${input.toolCallId}`
}
