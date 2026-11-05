import type { ChatMessage } from '../shared/execution/types'

/** Same default as the session store; kept here so this pure rule has no state dependency. */
export const AGENT_CONTEXT_WINDOW = 20

/** A tail window must begin at a real user turn, never at an assistant tool call. */
export function trimOrphanToolMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const callIds = new Set<string>()
  const out: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (call.id) callIds.add(call.id)
      }
    }
    if (message.role === 'tool' && (!message.toolCallId || !callIds.has(message.toolCallId))) continue
    out.push(message)
  }
  const firstUser = out.findIndex((message) => message.role === 'user')
  return firstUser >= 0 ? out.slice(firstUser) : []
}

function meaningfulUser(message: ChatMessage): boolean {
  return message.role === 'user' &&
    message.hiddenFromConversation !== true &&
    message.content.trim().length > 0
}

function pairedWindow(messages: readonly ChatMessage[]): ChatMessage[] {
  const callIds = new Set<string>()
  const clean: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        if (call.id) callIds.add(call.id)
      }
    }
    if (message.role === 'tool' && (!message.toolCallId || !callIds.has(message.toolCallId))) continue
    clean.push(message)
  }
  if (clean.length === 0) return []
  const retainedCallIds = new Set(
    clean.flatMap((message) =>
      message.role === 'assistant' ? (message.toolCalls ?? []).map((call) => call.id) : [],
    ),
  )
  const resultIds = new Set(
    clean.flatMap((message) =>
      message.role === 'tool' && message.toolCallId ? [message.toolCallId] : [],
    ),
  )
  // A retained assistant(tool_calls) must still have all its results in the window.
  return clean.filter((message) =>
    message.role !== 'assistant' ||
    !message.toolCalls?.length ||
    message.toolCalls.every((call) => resultIds.has(call.id)),
  ).filter((message) =>
    message.role !== 'tool' ||
    (message.toolCallId !== undefined && retainedCallIds.has(message.toolCallId)),
  )
}

/**
 * Build the bounded, user-comprehensible model window.
 *
 * The first visible user requirement is an anchor; the remaining budget is a
 * tail of complete user turns plus paired assistant/tool messages. Existing
 * system messages and orphan tool results are never replayed to the model.
 */
export function modelMessageWindow(
  messages: readonly ChatMessage[],
  window = AGENT_CONTEXT_WINDOW,
): ChatMessage[] {
  const size = Number.isFinite(window) ? Math.max(0, Math.trunc(window)) : 0
  if (size === 0) return []
  const history = messages.filter((message) => message.role !== 'system')
  const firstIndex = history.findIndex(meaningfulUser)
  if (firstIndex < 0) return trimOrphanToolMessages(history.slice(-size))

  const anchor = history[firstIndex]!
  const afterAnchor = history.slice(firstIndex + 1)
  const paired = pairedWindow(afterAnchor)
  const tail = paired.slice(-(size - 1))
  // A tool-only tail still needs its originating assistant message in the window.
  const tailCallIds = new Set(
    tail.flatMap((message) =>
      message.role === 'tool' && message.toolCallId ? [message.toolCallId] : [],
    ),
  )
  const missingCalls = paired.slice(0, Math.max(0, paired.length - tail.length)).filter((message) =>
    message.role === 'assistant' &&
    message.toolCalls?.some((call) => tailCallIds.has(call.id)),
  )
  const compensated = pairedWindow([...missingCalls, ...tail])
  const budget = Math.max(0, size - 1)
  const boundedTail = compensated.slice(-budget)
  let safeTail = boundedTail
  while (
    safeTail.length > 0 &&
    (safeTail[0]?.role === 'tool' ||
      (safeTail[0]?.role === 'assistant' && safeTail[0]?.toolCalls?.length))
  ) {
    safeTail = safeTail.slice(1)
  }
  return [anchor, ...safeTail]
}
