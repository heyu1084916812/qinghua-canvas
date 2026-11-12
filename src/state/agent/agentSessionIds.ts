import type { StoragePort } from '../../platform/ports'
import type { AgentSession } from './agentSessionTypes'
import { normalizeAgentTaskRef } from '../../domain/agent/agentTask'
import { normalizeSessionKits } from '../../domain/shared/kitMention'

/** 会话当前任务字段；坏数据 / 旧数据返回空对象。 */
export function agentTaskFieldOf(value: unknown): Pick<AgentSession, 'agentTask'> {
  const agentTask = normalizeAgentTaskRef(value)
  return agentTask ? { agentTask } : {}
}

/** 会话 @ 套件字段（冻结版本）；坏数据 / 旧数据返回空对象。 */
export function kitRefsFieldOf(value: unknown): Pick<AgentSession, 'kitRefs'> {
  const kitRefs = normalizeSessionKits(value)
  return kitRefs.length > 0 ? { kitRefs } : {}
}

export function normalizeAgentSessionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.flatMap((id) =>
        typeof id === 'string' && id.trim() ? [id.trim()] : [],
      ),
    ),
  ]
}

export async function appendAgentSessionIds(input: {
  storage: StoragePort
  ensureSplit: () => Promise<void>
  id: string
  ids: readonly string[]
  currentIds: (session: AgentSession) => readonly string[]
  apply: (session: AgentSession, ids: string[]) => AgentSession
  load: (
    storage: StoragePort,
    id: string,
  ) => Promise<AgentSession | null>
  save: (
    storage: StoragePort,
    session: AgentSession,
  ) => Promise<void>
}): Promise<AgentSession | null> {
  const additions = normalizeAgentSessionIds(input.ids)
  await input.ensureSplit()
  if (additions.length === 0) return input.load(input.storage, input.id)
  return input.storage.transaction(
    ['agentSessions', 'agentMessages'],
    async (tx) => {
      const latest = await input.load(tx, input.id)
      if (!latest) return null
      const merged = [
        ...new Set([
          ...normalizeAgentSessionIds(input.currentIds(latest)),
          ...additions,
        ]),
      ]
      const next = {
        ...input.apply(latest, merged),
        updatedAt: Date.now(),
      }
      await input.save(tx, next)
      return next
    },
  )
}
