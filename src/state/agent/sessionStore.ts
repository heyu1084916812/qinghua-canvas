import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  AGENT_QUEUE_LIMIT,
  enqueueAgentTurn,
  normalizeQueuedTurns,
  removeAgentTurn,
  takeNextAgentTurn,
  updateAgentTurnText,
} from '../../domain/agent/queuedTurn'
import {
  AGENT_CONTEXT_WINDOW,
  modelMessageWindow,
} from '../../domain/agent/modelMessageWindow'
import {
  enqueueAgentSteer,
  normalizeAgentSteers,
  removeAgentSteers,
} from '../../domain/agent/steering'
import { confirmationSettlementMessages } from '../../domain/agent/confirmation'
import {
  activeTurnForSession,
  asMessages,
  loadMessages,
  loadSession,
  MESSAGE_SPLIT_MIGRATION_ID,
  replaceMessages,
  sessionRow,
  toSession,
} from './agentSessionPersistence'
import type {
  AgentSession,
  AgentSessionStore,
} from './agentSessionTypes'

export type {
  AgentSession,
  AgentSessionStore,
} from './agentSessionTypes'

/**
 * Agent 会话存储（设计文档 §8 / §12）。
 *
 * 两条要求直接决定这份代码的形状：
 *
 * ① **会话绑定项目**（§8）：一个会话属于一张画布。列表按 `projectId` 过滤 ——
 *    「在 A 项目问 B 项目的画布」从查询条件上就不可能发生。
 * ② **记忆隔离**（§8.2）：历史与上下文分开。表里存**全部历史**（展示回溯用），
 *    而 `contextFor` 每次只从**这一个会话**的记录里取窗口 ——
 *    隔离靠「按会话 id 查」，不靠「记得清空」。后者一旦漏调，就会出现
 *    「它知道我没在这个会话里说过的事」，而那正是多会话最经典的 bug。
 */

const splitReady = new WeakMap<StoragePort, Promise<void>>()
export { AGENT_CONTEXT_WINDOW } from '../../domain/agent/modelMessageWindow'

export function createAgentSessionStore(
  storage: StoragePort,
): AgentSessionStore {
  const migrateLegacyMessages = async (): Promise<void> => {
    const completed = await storage.query('storageMigrations', {
      id: MESSAGE_SPLIT_MIGRATION_ID,
    })
    if (completed[0]?.status === 'complete') return

    await storage.transaction(
      ['agentSessions', 'agentMessages', 'storageMigrations'],
      async (tx) => {
        const marker = await tx.query('storageMigrations', {
          id: MESSAGE_SPLIT_MIGRATION_ID,
        })
        if (marker[0]?.status === 'complete') return

        const sessions = await tx.query('agentSessions', {})
        let expectedMessages = 0
        for (const row of sessions) {
          const session = toSession(row)
          const messages = asMessages(row.messages)
          expectedMessages += messages.length
          await replaceMessages(
            tx,
            session.id,
            session.projectId,
            messages,
            session.updatedAt || Date.now(),
          )
          await tx.put('agentSessions', sessionRow(session, session.updatedAt))
        }

        const storedSessions = await tx.query('agentSessions', {})
        const storedMessages = await tx.query('agentMessages', {})
        if (storedSessions.some((row) => row.messages !== undefined)) {
          throw new Error('Agent 消息拆表校验失败：仍有会话携带 messages')
        }
        if (storedMessages.length !== expectedMessages) {
          throw new Error(
            `Agent 消息拆表校验失败：应为 ${expectedMessages} 条，实际 ${storedMessages.length} 条`,
          )
        }
        await tx.put('storageMigrations', {
          id: MESSAGE_SPLIT_MIGRATION_ID,
          status: 'complete',
          sessionCount: storedSessions.length,
          messageCount: storedMessages.length,
          completedAt: Date.now(),
        } as never)
      },
    )
  }

  const ensureSplit = (): Promise<void> => {
    const current = splitReady.get(storage)
    if (current) return current
    const pending = migrateLegacyMessages().catch((error) => {
      splitReady.delete(storage)
      throw error
    })
    splitReady.set(storage, pending)
    return pending
  }

  const find = async (id: string): Promise<AgentSession | null> => {
    await ensureSplit()
    return loadSession(storage, id)
  }

  return {
    get: find,
    migrateLegacyMessages: ensureSplit,

    async messagesFor(id) {
      await ensureSplit()
      return (await loadSession(storage, id))?.messages ?? []
    },

    async list(projectId) {
      await ensureSplit()
      const rows = await storage.query('agentSessions', { projectId })
      return rows.map((row) => toSession(row)).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async create({ projectId, channelId, model, title, imageModel, videoModel, skillId }) {
      await ensureSplit()
      const now = Date.now()
      const session: AgentSession = {
        id: createId('chat'),
        projectId,
        title: title?.trim() || '新对话',
        channelId,
        model,
        ...(imageModel ? { imageModel } : {}),
        ...(videoModel ? { videoModel } : {}),
        ...(skillId ? { skillId } : {}),
        queuedTurns: [],
        pendingSteers: [],
        messages: [],
        messageRevision: 0,
        createdAt: now,
        updatedAt: now,
      }
      await storage.put('agentSessions', sessionRow(session, now))
      return session
    },

    async save(session) {
      await ensureSplit()
      const now = Date.now()
      await storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const stored = await loadSession(tx, session.id)
          await tx.put(
            'agentSessions',
            sessionRow(
              {
                ...session,
                messageRevision: (stored?.messageRevision ?? 0) + 1,
              },
              now,
            ),
          )
          await replaceMessages(
            tx,
            session.id,
            session.projectId,
            session.messages,
            now,
          )
        },
      )
    },

    async updateFields(id, patch) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
        const latest = await loadSession(tx, id)
        if (!latest) return null
        const next = { ...latest, ...patch, updatedAt: Date.now() }
        await tx.put('agentSessions', sessionRow(next, next.updatedAt))
        return next
        },
      )
    },

    async saveMessages(id, messages) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
        const latest = await loadSession(tx, id)
        if (!latest) return null
        const now = Date.now()
        const next = {
          ...latest,
          messages,
          messageRevision: (latest.messageRevision ?? 0) + 1,
          updatedAt: now,
        }
        await tx.put('agentSessions', sessionRow(next, now))
        await replaceMessages(tx, id, next.projectId, messages, now)
        return next
        },
      )
    },

    async applyAgentOutcome(id, apply) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const latest = await loadSession(tx, id)
          if (!latest) return { ok: false as const, reason: 'missing' as const }
          if (
            (latest.messageRevision ?? 0) !==
            (apply.expectedRevision ?? 0)
          ) {
            return { ok: false as const, reason: 'conflict' as const }
          }
          const now = Date.now()
          const next: AgentSession = {
            ...latest,
            messages: [...apply.messages],
            pendingConfirmation: apply.pendingConfirmation,
            continuation: apply.continuation,
            allowedToolNames: apply.allowedToolNames
              ? [...apply.allowedToolNames]
              : undefined,
            pendingSteers: removeAgentSteers(
              latest.pendingSteers,
              apply.removeSteerIds ?? [],
            ),
            messageRevision: (latest.messageRevision ?? 0) + 1,
            updatedAt: now,
          }
          await tx.put('agentSessions', sessionRow(next, now))
          await replaceMessages(tx, id, next.projectId, next.messages, now)
          return { ok: true as const, session: next }
        },
      )
    },

    async settleInterruptedConfirmation(id, request) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const latest = await loadSession(tx, id)
          if (!latest) return null
          const hasRequest = latest.messages.some(
            (message) =>
              message.role === 'assistant' &&
              message.toolCalls?.some(
                (call) => call.id === request.callId,
              ),
          )
          const messages = hasRequest
            ? confirmationSettlementMessages(
                latest.messages,
                request,
                'interrupted',
              )
            : latest.messages
          const pendingMatches =
            latest.pendingConfirmation?.callId === request.callId
          const messagesChanged =
            messages.length !== latest.messages.length
          if (!messagesChanged && !pendingMatches) return latest

          const now = Date.now()
          const next: AgentSession = {
            ...latest,
            messages,
            messageRevision: (latest.messageRevision ?? 0) + 1,
            ...(pendingMatches
              ? {
                  pendingConfirmation: undefined,
                  continuation: undefined,
                  allowedToolNames: undefined,
                }
              : {}),
            updatedAt: now,
          }
          await tx.put('agentSessions', sessionRow(next, now))
          if (messagesChanged) {
            await replaceMessages(
              tx,
              id,
              next.projectId,
              messages,
              now,
            )
          }
          return next
        },
      )
    },

    async settleInterruptedSession(
      id,
      request,
      result,
      expectedRevision,
    ) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const latest = await loadSession(tx, id)
          if (!latest) return null
          if (
            expectedRevision !== undefined &&
            (latest.messageRevision ?? 0) !== expectedRevision
          ) {
            return latest
          }
          const hasRequest =
            request !== undefined &&
            latest.messages.some(
              (message) =>
                message.role === 'assistant' &&
                message.toolCalls?.some(
                  (call) => call.id === request.callId,
                ),
            )
          const messages = hasRequest
            ? confirmationSettlementMessages(
                latest.messages,
                request!,
                result,
              )
            : latest.messages
          const pendingMatches =
            request !== undefined &&
            latest.pendingConfirmation?.callId === request.callId
          const shouldClear = request !== undefined
            ? pendingMatches
            : latest.pendingConfirmation !== undefined ||
              latest.continuation !== undefined ||
              latest.allowedToolNames !== undefined
          const messagesChanged = messages.length !== latest.messages.length
          const now = Date.now()
          const next: AgentSession = {
            ...latest,
            messages,
            messageRevision: (latest.messageRevision ?? 0) + 1,
            ...(shouldClear
              ? {
                  pendingConfirmation: undefined,
                  continuation: undefined,
                  allowedToolNames: undefined,
                }
              : {}),
            updatedAt: now,
          }
          await tx.put('agentSessions', sessionRow(next, now))
          if (messagesChanged) {
            await replaceMessages(tx, id, next.projectId, messages, now)
          }
          return next
        },
      )
    },

    async appendPendingAssetIds(id, assetIds) {
      const additions = [
        ...new Set(assetIds.filter((assetId) => assetId.trim() !== '')),
      ]
      if (additions.length === 0) return find(id)
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const latest = await loadSession(tx, id)
          if (!latest) return null
          const merged = [
            ...new Set([...(latest.pendingAssetIds ?? []), ...additions]),
          ]
          const next: AgentSession = {
            ...latest,
            pendingAssetIds: merged,
            updatedAt: Date.now(),
          }
          await tx.put('agentSessions', sessionRow(next, next.updatedAt))
          return next
        },
      )
    },

    async clearPendingAssetIds(id, assetIds) {
      const latest = await find(id)
      if (!latest) return null
      const sent = new Set(assetIds)
      const pending = (latest.pendingAssetIds ?? []).filter((assetId) => !sent.has(assetId))
      const next = {
        ...latest,
        ...(pending.length > 0 ? { pendingAssetIds: pending } : { pendingAssetIds: undefined }),
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', sessionRow(next, next.updatedAt))
      return next
    },

    async enqueueTurn(id, turn) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const latest = await loadSession(tx, id)
          if (!latest) return { ok: false as const, reason: 'missing' as const }
          /**
           * 队列项冻结的是“此刻仍待发送”的附件。入队与消费在同一事务里完成：
           * 连续排队时第二次只能拿到剩余附件，不会再把首条已冻结的图片复制一遍。
           */
          const pending = new Set(latest.pendingAssetIds ?? [])
          const frozenAssetIds = [
            ...new Set(
              (turn.pendingAssetIds ?? []).filter((assetId) =>
                pending.has(assetId),
              ),
            ),
          ]
          const activeCount = latest.activeTurn || latest.activeTurnId ? 1 : 0
          if (
            normalizeQueuedTurns(latest.queuedTurns).length >=
            AGENT_QUEUE_LIMIT - activeCount
          ) {
            return { ok: false as const, reason: 'full' as const }
          }
          const queued = enqueueAgentTurn(latest.queuedTurns, {
            ...turn,
            ...(frozenAssetIds.length > 0
              ? { pendingAssetIds: frozenAssetIds }
              : { pendingAssetIds: undefined }),
          })
          if (!queued.ok) {
            return { ok: false as const, reason: queued.reason }
          }
          const frozen = new Set(frozenAssetIds)
          const remaining = (latest.pendingAssetIds ?? []).filter(
            (assetId) => !frozen.has(assetId),
          )
          const next: AgentSession = {
            ...latest,
            queuedTurns: queued.turns,
            ...(remaining.length > 0
              ? { pendingAssetIds: remaining }
              : { pendingAssetIds: undefined }),
            updatedAt: Date.now(),
          }
          await tx.put('agentSessions', sessionRow(next, next.updatedAt))
          return { ok: true as const, session: next }
        },
      )
    },

    async removeQueuedTurn(id, turnId) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const latest = await loadSession(tx, id)
          if (!latest) return null
          if (latest.activeTurnId === turnId || activeTurnForSession(latest)?.id === turnId) {
            return latest
          }
          const next = {
            ...latest,
            queuedTurns: removeAgentTurn(latest.queuedTurns, turnId),
            updatedAt: Date.now(),
          }
          await tx.put('agentSessions', sessionRow(next, next.updatedAt))
          return next
        },
      )
    },

    async updateQueuedTurnText(id, turnId, text) {
      if (!text.trim()) return find(id)
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
        const latest = await loadSession(tx, id)
        if (!latest) return null
        if (latest.activeTurnId === turnId || activeTurnForSession(latest)?.id === turnId) {
          return latest
        }
        const next = {
          ...latest,
          queuedTurns: updateAgentTurnText(latest.queuedTurns, turnId, text),
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', sessionRow(next, next.updatedAt))
        return next
        },
      )
    },

    async promoteQueuedTurnToSteer(id, turnId, steerId) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
        const latest = await loadSession(tx, id)
        if (!latest) return { ok: false as const, reason: 'missing' as const }
        if (latest.pendingConfirmation) {
          return { ok: false as const, reason: 'awaiting_confirmation' as const }
        }
        /**
         * 正常结构里活动回合不在 waiting queue，下面这段只兜旧快照 / 迟到点击：
         * 同一句文本若先被 pump 发出、再被 promote 注入，会执行两遍。
         */
        if (latest.activeTurnId === turnId || activeTurnForSession(latest)?.id === turnId) {
          return { ok: false as const, reason: 'active' as const }
        }
        const turn = latest.queuedTurns.find((item) => item.id === turnId)
        if (!turn) return { ok: false as const, reason: 'missing' as const }
        if (turn.pendingAssetIds?.length) {
          return { ok: false as const, reason: 'has_assets' as const }
        }
        const steering = enqueueAgentSteer(latest.pendingSteers, {
          id: steerId,
          text: turn.text,
          createdAt: Date.now(),
        })
        if (!steering.ok) {
          return { ok: false as const, reason: 'steer_full' as const }
        }
        const next = {
          ...latest,
          pendingSteers: steering.steers,
          queuedTurns: removeAgentTurn(latest.queuedTurns, turnId),
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', sessionRow(next, next.updatedAt))
        return { ok: true as const, session: next }
        },
      )
    },

    async repairConfirmationSteerCollision(id) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
        const latest = await loadSession(tx, id)
        if (!latest) return null
        if (!latest.pendingConfirmation || latest.pendingSteers.length === 0) {
          return null
        }

        let queuedTurns = normalizeQueuedTurns(latest.queuedTurns)
        const recoveredSteerIds = new Set<string>()
        let recoveredAll = true
        for (const steer of normalizeAgentSteers(latest.pendingSteers)) {
          const recovered = enqueueAgentTurn(queuedTurns, {
            id: `recovered-${steer.id}`,
            text: steer.text,
            createdAt: steer.createdAt,
            channelId: latest.channelId,
            model: latest.model,
            ...(latest.imageModel ? { imageModel: latest.imageModel } : {}),
            ...(latest.videoModel ? { videoModel: latest.videoModel } : {}),
            ...(latest.skillId ? { skillId: latest.skillId } : {}),
            ...(latest.autoRun ? { autoRun: true } : {}),
            ...(steer.imageNodeIds?.length
              ? { pendingAssetIds: [...steer.imageNodeIds] }
              : {}),
          })
          if (!recovered.ok) {
            recoveredAll = false
            break
          }
          queuedTurns = recovered.turns
          recoveredSteerIds.add(steer.id)
        }
        /*
         * 不做半恢复：队列已满时若先清确认卡、再把 steer 留在原地，
         * 会留下一个没有任务可挂靠的待发送消息。保持整行原状，等用户腾出队列后重试。
         */
        if (!recoveredAll) return null

        const next: AgentSession = {
          ...latest,
          messages: confirmationSettlementMessages(
            latest.messages,
            latest.pendingConfirmation,
            'canceled',
          ),
          messageRevision: (latest.messageRevision ?? 0) + 1,
          queuedTurns,
          pendingSteers: [],
          pendingConfirmation: undefined,
          continuation: undefined,
          allowedToolNames: undefined,
          activeTurnId: undefined,
          activeTurnStartedAt: undefined,
          activeTurn: undefined,
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', sessionRow(next, next.updatedAt))
        await replaceMessages(
          tx,
          next.id,
          next.projectId,
          next.messages,
          next.updatedAt,
        )
        return next
        },
      )
    },

    async enqueueSteer(id, steer) {
      const latest = await find(id)
      if (!latest) return { ok: false, reason: 'missing' }
      const queued = enqueueAgentSteer(latest.pendingSteers, steer)
      if (!queued.ok) return { ok: false, reason: queued.reason }
      const next = {
        ...latest,
        pendingSteers: queued.steers,
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', sessionRow(next, next.updatedAt))
      return { ok: true, session: next }
    },

    async removeSteers(id, steerIds) {
      const latest = await find(id)
      if (!latest || steerIds.length === 0) return latest
      const next = {
        ...latest,
        pendingSteers: removeAgentSteers(latest.pendingSteers, steerIds),
        updatedAt: Date.now(),
      }
      await storage.put('agentSessions', sessionRow(next, next.updatedAt))
      return next
    },

    async claimNextQueuedTurn(id) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
        const latest = await loadSession(tx, id)
        if (!latest) return null
        if (latest.activeTurnId || latest.activeTurn) return null
        const taken = takeNextAgentTurn(latest.queuedTurns)
        const turn = taken.turn
        if (!turn) return null
        const session = {
          ...latest,
          queuedTurns: taken.turns,
          activeTurnId: turn.id,
          activeTurnStartedAt: Date.now(),
          activeTurn: turn,
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', sessionRow(session, session.updatedAt))
        return { session, turn }
        },
      )
    },

    async finishActiveQueuedTurn(id, turnId, completed) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
        const latest = await loadSession(tx, id)
        if (!latest) return null
        const activeTurn = activeTurnForSession(latest)
        if (activeTurn?.id !== turnId) return latest
        const waitingTurns = removeAgentTurn(latest.queuedTurns, turnId)
        const next = {
          ...latest,
          queuedTurns: completed
            ? waitingTurns
            : activeTurn
              ? [activeTurn, ...waitingTurns]
              : waitingTurns,
          activeTurnId: undefined,
          activeTurnStartedAt: undefined,
          activeTurn: undefined,
          updatedAt: Date.now(),
        }
        await tx.put('agentSessions', sessionRow(next, next.updatedAt))
        return next
        },
      )
    },

    async releaseActiveTurn(id) {
      await ensureSplit()
      return storage.transaction(
        ['agentSessions', 'agentMessages'],
        async (tx) => {
          const latest = await loadSession(tx, id)
          if (!latest) return null
          if (!latest.activeTurnId && !latest.activeTurn) return latest
          const activeTurn = activeTurnForSession(latest)
          const next = {
            ...latest,
            queuedTurns: activeTurn
              ? [activeTurn, ...removeAgentTurn(latest.queuedTurns, activeTurn.id)]
              : latest.queuedTurns,
            activeTurnId: undefined,
            activeTurnStartedAt: undefined,
            activeTurn: undefined,
            updatedAt: Date.now(),
          }
          await tx.put('agentSessions', sessionRow(next, next.updatedAt))
          return next
        },
      )
    },

    async rename(id, title) {
      const s = await find(id)
      if (!s) return
      const next = { ...s, title: title.trim() || s.title, updatedAt: Date.now() }
      await storage.put('agentSessions', sessionRow(next, next.updatedAt))
    },

    async remove(id) {
      await storage.transaction(
        ['agentSessions', 'agentMessages', 'agentJobs', 'agentEvents'],
        async (tx) => {
          const messages = await tx.query('agentMessages', { sessionId: id })
          const jobs = await tx.query('agentJobs', { sessionId: id })
          const events = await tx.query('agentEvents', { sessionId: id })
          for (const message of messages) {
            await tx.delete('agentMessages', message.id)
          }
          for (const event of events) await tx.delete('agentEvents', event.id)
          for (const job of jobs) await tx.delete('agentJobs', job.id)
          await tx.delete('agentSessions', id)
        },
      )
    },

    async contextFor(id, window = AGENT_CONTEXT_WINDOW) {
      await ensureSplit()
      const sessions = await storage.query('agentSessions', { id })
      if (!sessions[0]) return []
      const limit = Math.max(0, Math.trunc(window))
      if (limit === 0) return []
      const history = await loadMessages(storage, id)
      if (storage.queryPage) {
        const page = await storage.queryPage(
          'agentMessages',
          { sessionId: id },
          {
            orderBy: { field: 'sequence', direction: 'desc' },
            limit,
          },
        )
        if (page.total > 0) return modelMessageWindow(history, limit)
      }
      if (!storage.queryPage) {
        if (history.length > 0) return modelMessageWindow(history, limit)
      }
      const legacy = asMessages(sessions[0].messages)
      return legacy.length > 0 ? modelMessageWindow(legacy, limit) : []
    },
  }
}
