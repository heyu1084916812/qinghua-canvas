import type { ChatMessage } from '../../domain/shared/execution/types'
import type { RowOf, StoragePort } from '../../platform/ports'
import {
  normalizeQueuedTurns,
  type QueuedAgentTurn,
} from '../../domain/agent/queuedTurn'
import { normalizeAgentSteers } from '../../domain/agent/steering'
import { normalizeStoredTaskPlan } from '../../domain/agent/taskPlan'
import { isAgentToolName, type AgentToolName } from '../../domain/agent/toolRegistry'
import type { AgentSession } from './agentSessionTypes'

export const asMessages = (v: unknown): ChatMessage[] =>
  Array.isArray(v) ? (v as ChatMessage[]) : []
export const MESSAGE_SPLIT_MIGRATION_ID = 'agent-messages.split.v1'

export const activeTurnForSession = (
  session: Pick<AgentSession, 'activeTurn' | 'activeTurnId' | 'queuedTurns'>,
): QueuedAgentTurn | undefined =>
  session.activeTurn ??
  session.queuedTurns.find((turn) => turn.id === session.activeTurnId)

interface AgentMessageRow extends Record<string, unknown> {
id: string
sessionId: string
projectId: string
sequence: number
createdAt: number
updatedAt: number
message: ChatMessage
}

function messageRow(
sessionId: string,
projectId: string,
sequence: number,
message: ChatMessage,
now = Date.now(),
): AgentMessageRow {
const createdAt = message.createdAt ?? now
return {
  id: `${sessionId}::message::${String(sequence).padStart(6, '0')}`,
  sessionId,
  projectId,
  sequence,
  createdAt,
  updatedAt: createdAt,
  message,
}
}

function messageOf(row: RowOf<'agentMessages'>): ChatMessage | null {
const message = row.message
if (!message || typeof message !== 'object') return null
const candidate = message as Partial<ChatMessage>
if (
  candidate.role !== 'system' &&
  candidate.role !== 'user' &&
  candidate.role !== 'assistant' &&
  candidate.role !== 'tool'
) {
  return null
}
return typeof candidate.content === 'string' ? (candidate as ChatMessage) : null
}

export const messagesFromRows = (
  rows: readonly RowOf<'agentMessages'>[],
): ChatMessage[] =>
  [...rows]
    .sort(
      (left, right) =>
        Number(left.sequence ?? 0) - Number(right.sequence ?? 0) ||
        String(left.id).localeCompare(String(right.id)),
    )
    .map(messageOf)
    .filter((message): message is ChatMessage => message !== null)

export const toSession = (
  row: RowOf<'agentSessions'>,
  messages: ChatMessage[] = [],
): AgentSession => {
  const taskPlan = normalizeStoredTaskPlan(row.taskPlan)
  const rawQueuedTurns = normalizeQueuedTurns(row.queuedTurns)
  const storedActiveTurn = normalizeQueuedTurns(
    row.activeTurn ? [row.activeTurn] : [],
  )[0]
  const activeTurnId =
    typeof row.activeTurnId === 'string' && row.activeTurnId
      ? row.activeTurnId
      : storedActiveTurn?.id
  /**
   * 旧数据里活动回合仍可能同时留在 queuedTurns。读取时统一成
   * waiting-only 队列，下一次领取/结算会把新结构真正写回存储。
   */
  const activeTurn =
    (storedActiveTurn?.id === activeTurnId ? storedActiveTurn : undefined) ??
    rawQueuedTurns.find((turn) => turn.id === activeTurnId)
  const queuedTurns = activeTurnId
    ? rawQueuedTurns.filter((turn) => turn.id !== activeTurnId)
    : rawQueuedTurns
  return {
  id: String(row.id),
  projectId: String(row.projectId ?? ''),
  title: String(row.title ?? '新对话'),
  channelId: String(row.channelId ?? ''),
  model: String(row.model ?? ''),
  ...(typeof row.imageModel === 'string' && row.imageModel ? { imageModel: row.imageModel } : {}),
  ...(typeof row.videoModel === 'string' && row.videoModel ? { videoModel: row.videoModel } : {}),
  ...(typeof row.skillId === 'string' && row.skillId ? { skillId: row.skillId } : {}),
  ...(row.autoRun === true ? { autoRun: true } : {}),
  ...(typeof row.contextWindow === 'number' && row.contextWindow > 0
    ? { contextWindow: row.contextWindow }
    : {}),
  ...(Array.isArray(row.pendingAssetIds) && row.pendingAssetIds.length > 0
    ? { pendingAssetIds: row.pendingAssetIds.filter((x): x is string => typeof x === 'string') }
    : {}),
  queuedTurns,
  pendingSteers: normalizeAgentSteers(row.pendingSteers),
  ...(activeTurnId
    ? { activeTurnId }
    : {}),
  ...(activeTurn ? { activeTurn } : {}),
  ...(typeof row.activeTurnStartedAt === 'number' && row.activeTurnStartedAt > 0
    ? { activeTurnStartedAt: row.activeTurnStartedAt }
    : {}),
  ...(row.pendingConfirmation &&
  typeof row.pendingConfirmation === 'object' &&
  typeof (row.pendingConfirmation as { callId?: unknown }).callId === 'string' &&
  typeof (row.pendingConfirmation as { name?: unknown }).name === 'string'
    ? {
        pendingConfirmation: {
          callId: String((row.pendingConfirmation as { callId: string }).callId),
          name: String((row.pendingConfirmation as { name: string }).name),
          args: (row.pendingConfirmation as { args?: unknown }).args,
        },
      }
    : {}),
  ...(Array.isArray(row.allowedToolNames)
    ? {
        allowedToolNames: row.allowedToolNames.filter(
          (name): name is AgentToolName =>
            typeof name === 'string' && isAgentToolName(name),
        ),
      }
    : {}),
  ...(row.continuation &&
  typeof row.continuation === 'object' &&
  (row.continuation as { reason?: unknown }).reason === 'max_steps' &&
  typeof (row.continuation as { maxSteps?: unknown }).maxSteps === 'number'
    ? {
        continuation: {
          reason: 'max_steps' as const,
          maxSteps: Math.max(
            1,
            Math.trunc((row.continuation as { maxSteps: number }).maxSteps),
          ),
          createdAt:
            typeof (row.continuation as { createdAt?: unknown }).createdAt === 'number'
              ? (row.continuation as { createdAt: number }).createdAt
              : Number(row.updatedAt ?? 0),
          ...(typeof (row.continuation as { queuedTurnId?: unknown }).queuedTurnId === 'string' &&
          (row.continuation as { queuedTurnId: string }).queuedTurnId
            ? {
                queuedTurnId: (row.continuation as { queuedTurnId: string }).queuedTurnId,
              }
            : {}),
        },
      }
    : {}),
  ...(taskPlan ? { taskPlan } : {}),
  messages,
  messageRevision: Math.max(
    0,
    Math.trunc(Number(row.messageRevision ?? 0)) || 0,
  ),
  createdAt: Number(row.createdAt ?? 0),
  updatedAt: Number(row.updatedAt ?? 0),
  }
}

export const sessionRow = (
  session: AgentSession,
  updatedAt = Date.now(),
): RowOf<'agentSessions'> => {
  const { messages: _messages, ...metadata } = session
  return { ...metadata, updatedAt } as unknown as RowOf<'agentSessions'>
}

export const replaceMessages = async (
  target: StoragePort,
  sessionId: string,
  projectId: string,
  messages: readonly ChatMessage[],
  now = Date.now(),
): Promise<void> => {
  const previous = await target.query('agentMessages', { sessionId })
  for (const row of previous) await target.delete('agentMessages', row.id)
  if (messages.length === 0) return
  await target.bulkPut(
    'agentMessages',
    messages.map((message, sequence) =>
      messageRow(sessionId, projectId, sequence, message, now),
    ) as unknown as RowOf<'agentMessages'>[],
  )
}

export const loadMessages = async (
  target: StoragePort,
  id: string,
): Promise<ChatMessage[]> => {
  const rows = await target.query('agentMessages', { sessionId: id })
  return messagesFromRows(rows)
}

export const loadSession = async (
  target: StoragePort,
  id: string,
): Promise<AgentSession | null> => {
  const rows = await target.query('agentSessions', { id })
  if (!rows[0]) return null
  const messages = await loadMessages(target, id)
  if (rows[0].messages === undefined) {
    return toSession(rows[0], messages)
  }
  const legacyMessages = asMessages(rows[0].messages)
  const session = toSession(rows[0])
  await replaceMessages(
    target,
    session.id,
    session.projectId,
    legacyMessages,
    session.updatedAt || Date.now(),
  )
  await target.put('agentSessions', sessionRow(session, session.updatedAt))
  return toSession(sessionRow(session, session.updatedAt), legacyMessages)
}
