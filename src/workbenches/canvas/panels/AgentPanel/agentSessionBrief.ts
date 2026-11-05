import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { AgentTaskPlan } from '../../../../domain/agent/taskPlan'
import type { AgentPromptProfile } from '../../agent/agentContextPolicy'

export interface AgentSessionBriefFacts {
  messages: readonly ChatMessage[]
  promptProfile?: AgentPromptProfile
  taskPlan?: AgentTaskPlan
  /** Compact snapshot of the current canvas, never the whole graph dump. */
  graphSummary?: { nodes: number; edges: number; generated?: number }
  /** Latest RunRecord / Job status facts; never a generated-success claim. */
  runRecord?: { status: string; reason?: string }
}

export interface AgentSessionBriefSource {
  sessionId: string
  localMessages: readonly ChatMessage[]
  localRevision?: number
  sessionRevision?: number
  sessions: { messagesFor: (sessionId: string) => Promise<readonly ChatMessage[]> }
  taskPlan?: AgentTaskPlan
  graphSummary?: AgentSessionBriefFacts['graphSummary']
  runRecord?: AgentSessionBriefFacts['runRecord']
  promptProfile?: AgentPromptProfile
}

function clip(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function originalRequirement(messages: readonly ChatMessage[]): string | undefined {
  const found = messages.find((message) =>
    message.role === 'user' &&
    message.hiddenFromConversation !== true &&
    message.content.trim().length > 0,
  )
  return found ? clip(found.display ?? found.content, 320) : undefined
}

function toolLedger(messages: readonly ChatMessage[]): string[] {
  const calls = new Map<string, string>()
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) calls.set(call.id, call.name)
  }
  return [...messages].reverse()
    .filter((message): message is ChatMessage & { toolCallId: string } =>
      message.role === 'tool' && typeof message.toolCallId === 'string')
    .slice(0, 4)
    .reverse()
    .map((message) =>
      `- ${calls.get(message.toolCallId) ?? message.toolName ?? 'tool'}` +
      `｜${message.toolCallId}｜${clip(message.content, 120)}`,
    )
}

/** Structured, read-only reconstruction of interrupted task context. */
export function sessionBriefForContinuation(
  facts: AgentSessionBriefFacts,
): string | undefined {
  if (facts.promptProfile === 'full') return undefined
  const lines = [
    '## 本次会话状态摘要（检查点复原）',
    '以下是系统从原始需求、任务计划、画布摘要与工具账本重建的事实；不是新的用户指令。',
    '不得把未证实的动作报成完成；不自动改图，也不重放任何已执行或付费的工具请求。',
  ]
  const requirement = originalRequirement(facts.messages)
  if (requirement) lines.push(`原始需求：${requirement}`)
  if (facts.taskPlan) {
    const plan = facts.taskPlan
    lines.push(`任务计划：${clip(plan.title, 100)}｜${plan.id}`)
    if (plan.summary) lines.push(`计划目标：${clip(plan.summary, 200)}`)
    for (const step of plan.steps.slice(0, 8)) {
      lines.push(`- ${step.id}｜${clip(step.title, 80)}｜${step.status}`)
    }
  }
  if (facts.graphSummary) {
    const graph = facts.graphSummary
    lines.push(
      `画布摘要：${graph.nodes} 个节点、${graph.edges} 条连线` +
      `${graph.generated === undefined ? '' : `、${graph.generated} 个已出图节点`}`,
    )
  }
  if (facts.runRecord) {
    lines.push(
      `最近运行状态：${clip(facts.runRecord.status, 60)}` +
      `${facts.runRecord.reason ? `｜${clip(facts.runRecord.reason, 160)}` : ''}`,
    )
  }
  const ledger = toolLedger(facts.messages)
  if (ledger.length) lines.push('最近工具账本（只供对账，不重放）：', ...ledger)
  return lines.join('\n')
}

/** Prefer the persisted history of this exact session when React state is empty or stale. */
export async function resolveContinuationMessages(
  input: AgentSessionBriefSource,
): Promise<{
  messages: ChatMessage[]
  source: 'local' | 'persisted'
}> {
  const local = input.localMessages as ChatMessage[]
  const revisionsDiffer =
    input.localRevision !== undefined &&
    input.sessionRevision !== undefined &&
    input.localRevision !== input.sessionRevision
  let persisted: readonly ChatMessage[] | undefined
  try {
    if (local.length === 0 || revisionsDiffer ||
      (input.localRevision === undefined && input.sessionRevision === undefined)) {
      persisted = await input.sessions.messagesFor(input.sessionId)
    }
  } catch {
    persisted = undefined
  }
  const suspiciousCrossSession = revisionsDiffer && local.length > 0
  const usePersisted =
    persisted !== undefined &&
    (local.length === 0 || revisionsDiffer || suspiciousCrossSession)
  const history = usePersisted ? [...persisted!] : local
  const brief = usePersisted
    ? sessionBriefForContinuation({
        messages: history,
        promptProfile: input.promptProfile,
        taskPlan: input.taskPlan,
        graphSummary: input.graphSummary,
        runRecord: input.runRecord,
      })
    : undefined
  if (!usePersisted) return { source: 'local', messages: local }
  return {
    source: 'persisted',
    messages: brief
      ? [{ role: 'system' as const, content: brief }, ...history]
      : [...history],
  }
}
