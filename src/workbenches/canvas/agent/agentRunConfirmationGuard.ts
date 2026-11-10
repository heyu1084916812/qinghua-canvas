import type { ChatMessage } from '../../../domain/shared/execution/types'
import { createId } from '../../../shared/id'
import type { AgentLoopOutcome } from './agentLoop'

const RUN_PERMISSION_QUESTION =
  /(?:你希望我|要不要我|需要我|要我|是否|可以帮你|可以给你).{0,48}(?:运行|执行|生成|出图|跑|继续)/
const AFFIRMATIVE_REPLY =
  /^(?:允许|同意|确认|可以|好|好的|行|嗯|继续|运行吧|开始吧|yes|ok)[。.!！,，\s]*$/i

type Precheck = (
  name: string,
  args: unknown,
) => { ok: boolean; result?: unknown } | undefined

function asksToRunAfterPreview(text: string): boolean {
  const normalized = text.replace(/\s+/g, '')
  return /[？?]/.test(normalized) && RUN_PERMISSION_QUESTION.test(normalized)
}

function generationNodeIdsFromApplyPlan(message: ChatMessage): string[] {
  try {
    const value = JSON.parse(message.content) as {
      ok?: unknown
      resolvedNodes?: unknown
    }
    if (value.ok === false || !Array.isArray(value.resolvedNodes)) return []
    return [...new Set(value.resolvedNodes.flatMap((node) => {
      if (!node || typeof node !== 'object') return []
      const row = node as Record<string, unknown>
      return row.created === true &&
        row.type === 'generation' &&
        typeof row.nodeId === 'string' &&
        row.nodeId
        ? [row.nodeId]
        : []
    }))]
  } catch {
    return []
  }
}

function applyPlanGenerationTargets(
  messages: readonly ChatMessage[],
  start: number,
  end: number,
): string[] {
  const callNameById = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) callNameById.set(call.id, call.name)
  }
  for (let index = end - 1; index >= start; index -= 1) {
    const message = messages[index]!
    if (message.role !== 'tool') continue
    const name =
      message.toolName || callNameById.get(message.toolCallId ?? '') || ''
    if (name !== 'applyPlan') continue
    const ids = generationNodeIdsFromApplyPlan(message)
    if (ids.length > 0) return ids
  }
  return []
}

/**
 * 模型有时把“是否运行”写成普通正文，导致用户只能再发一句「允许」，
 * 从新回合重跑参考分析。这里把这种文本询问和执行层真正的 `runNode`
 * 确认请求对接起来。
 */
export function runNodeConfirmationTargets(
  messages: readonly ChatMessage[],
  finalText = '',
): string[] {
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === 'user') {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex < 0) return []
  if (finalText && asksToRunAfterPreview(finalText)) {
    return applyPlanGenerationTargets(messages, lastUserIndex + 1, messages.length)
  }
  const userText = messages[lastUserIndex]!.content.trim()
  if (!AFFIRMATIVE_REPLY.test(userText)) return []
  let questionIndex = -1
  for (let index = lastUserIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    if (message.role === 'assistant' && asksToRunAfterPreview(message.content)) {
      questionIndex = index
      break
    }
  }
  if (questionIndex < 0) return []
  let previousUserIndex = -1
  for (let index = questionIndex - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === 'user') {
      previousUserIndex = index
      break
    }
  }
  return applyPlanGenerationTargets(messages, previousUserIndex + 1, questionIndex)
}

export function runNodeConfirmation(input: {
  messages: ChatMessage[]
  allowedToolNames: ReadonlySet<string>
  precheck?: Precheck
  finalText?: string
  content?: string
  reasoning?: string
}): AgentLoopOutcome | null {
  const targets = runNodeConfirmationTargets(input.messages, input.finalText)
  if (targets.length === 0 || !input.allowedToolNames.has('runNode')) return null
  const args = { nodeIds: targets }
  const pre = input.precheck?.('runNode', args)
  if (pre && pre.ok === false) return null
  const call = {
    id: createId('jsoncall'),
    name: 'runNode',
    args: JSON.stringify(args),
  }
  input.messages.push({
    role: 'assistant',
    content: input.content ?? '',
    ...(input.reasoning ? { reasoning: input.reasoning } : {}),
    createdAt: Date.now(),
    toolCalls: [call],
  })
  return {
    kind: 'confirm',
    request: { callId: call.id, name: call.name, args },
    messages: input.messages,
  }
}

export function recoverRunNodeConfirmation(
  messages: ChatMessage[],
  allowedToolNames: ReadonlySet<string>,
  precheck?: Precheck,
): AgentLoopOutcome | null {
  return runNodeConfirmation({ messages, allowedToolNames, precheck })
}

export function confirmRunNodeFromFinalAnswer(input: {
  messages: ChatMessage[]
  allowedToolNames: ReadonlySet<string>
  precheck?: Precheck
  text: string
  reasoning?: string
}): AgentLoopOutcome | null {
  return runNodeConfirmation({
    messages: input.messages,
    allowedToolNames: input.allowedToolNames,
    precheck: input.precheck,
    finalText: input.text,
    content: input.text,
    reasoning: input.reasoning,
  })
}
