import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  settleAgentInterruption,
  type AgentInterruptSettlementInput,
} from './agentInterruptSettlement'

const session: AgentSession = {
  id: 'session-interrupt',
  projectId: 'p1',
  title: '停止收口',
  channelId: '',
  model: 'chat-model',
  pendingSteers: [
    { id: 'steer-1', text: '旧引导', createdAt: 1 },
  ],
  queuedTurns: [],
  messages: [{ role: 'user', content: '旧消息' }],
  messageRevision: 4,
  createdAt: 1,
  updatedAt: 1,
}

const request = {
  callId: 'call-1',
  name: 'deleteNodes',
  args: { nodeIds: ['node-1'] },
}

function input(
  overrides: Partial<AgentInterruptSettlementInput> = {},
): AgentInterruptSettlementInput {
  const latest = {
    ...session,
    messages: [{ role: 'assistant' as const, content: '已停止' }],
    messageRevision: 5,
  }
  return {
    session,
    request,
    result: 'interrupted',
    turnOrigin: {
      jobId: 'job-1',
      turnId: 'turn-1',
      queueTurnId: 'queue-1',
      messageRevision: 4,
    },
    abortController: new AbortController(),
    isActivityActive: () => true,
    turnMatchesActivity: () => true,
    queueTurnMatchesActivity: () => true,
    clearQueueDrain: vi.fn(),
    settleSession: vi.fn(async () => latest),
    transitionSessionJob: vi.fn(async () => null),
    removeSteers: vi.fn(async () => ({
      ...latest,
      pendingSteers: [],
    })),
    finishQueuedTurn: vi.fn(async () => ({
      ...latest,
      pendingSteers: [],
      activeTurnId: undefined,
    })),
    releaseActivity: vi.fn(),
    isCurrentSession: () => true,
    notify: vi.fn(),
    deletePerSessionRefs: vi.fn(),
    applySessionSnapshot: vi.fn(),
    setMessages: vi.fn(),
    clearLiveActivities: vi.fn(),
    clearLiveProcess: vi.fn(),
    clearRunTasks: vi.fn(),
    setStatus: vi.fn(),
    errorText: (error) =>
      error instanceof Error ? error.message : String(error),
    ...overrides,
  }
}

describe('settleAgentInterruption', () => {
  it('★★ 当前回合 stop：abort、revision 屏障、Job、steer、queue、UI 全收口', async () => {
    const h = input()
    const latest = await settleAgentInterruption(h)
    expect(h.abortController?.signal.aborted).toBe(true)
    expect(h.clearQueueDrain).toHaveBeenCalledTimes(1)
    expect(h.settleSession).toHaveBeenCalledWith(
      session.id,
      request,
      'interrupted',
      4,
    )
    expect(h.transitionSessionJob).toHaveBeenCalledWith(
      session.id,
      'canceled',
      'interrupted',
      { pendingCallId: undefined },
      { reason: 'user_stopped' },
      expect.objectContaining({
        jobId: 'job-1',
        turnId: 'turn-1',
        queueTurnId: 'queue-1',
      }),
    )
    expect(h.removeSteers).toHaveBeenCalledWith(
      session.id,
      ['steer-1'],
    )
    expect(h.finishQueuedTurn).toHaveBeenCalledWith(
      session.id,
      'queue-1',
      false,
    )
    expect(latest?.pendingSteers).toEqual([])
    expect(h.releaseActivity).toHaveBeenCalledWith(
      'queue-1',
      'turn-1',
    )
    expect(h.deletePerSessionRefs).toHaveBeenCalledWith(session.id)
    expect(h.applySessionSnapshot).toHaveBeenCalledWith(latest)
    expect(h.setMessages).toHaveBeenCalledWith(latest?.messages)
    expect(h.setStatus).toHaveBeenCalledWith(session.id, {
      kind: 'idle',
    })
  })

  it('★★ 旧回合已被新 activity 接管：不 abort、不碰 UI/refs', async () => {
    const h = input({
      isActivityActive: () => true,
      turnMatchesActivity: () => false,
      queueTurnMatchesActivity: () => false,
    })
    await settleAgentInterruption(h)
    expect(h.abortController?.signal.aborted).toBe(false)
    expect(h.clearQueueDrain).not.toHaveBeenCalled()
    expect(h.finishQueuedTurn).not.toHaveBeenCalled()
    expect(h.deletePerSessionRefs).not.toHaveBeenCalled()
    expect(h.applySessionSnapshot).not.toHaveBeenCalled()
    expect(h.setMessages).not.toHaveBeenCalled()
    expect(h.clearLiveActivities).not.toHaveBeenCalled()
    expect(h.setStatus).not.toHaveBeenCalled()
    expect(h.releaseActivity).toHaveBeenCalledWith(
      'queue-1',
      'turn-1',
    )
  })

  it('★★ revision 冲突返回存储最新 session，不用旧 React 快照覆盖', async () => {
    const latest = {
      ...session,
      messages: [{ role: 'assistant' as const, content: '新回合消息' }],
      messageRevision: 9,
    }
    const h = input({
      settleSession: vi.fn(async () => latest),
      removeSteers: vi.fn(async () => latest),
      finishQueuedTurn: vi.fn(async () => latest),
    })
    const result = await settleAgentInterruption(h)
    expect(result).toBe(latest)
    expect(h.setMessages).toHaveBeenCalledWith(latest.messages)
    expect(h.applySessionSnapshot).toHaveBeenCalledWith(latest)
  })

  it('★★ queue token 不匹配时不销新队列项', async () => {
    const h = input({
      queueTurnMatchesActivity: () => false,
    })
    await settleAgentInterruption(h)
    expect(h.finishQueuedTurn).not.toHaveBeenCalled()
    expect(h.releaseActivity).toHaveBeenCalledWith(
      'queue-1',
      'turn-1',
    )
  })

  it('★★ transition 抛错仍继续 remove / finish / UI 收口并 notify', async () => {
    const h = input({
      transitionSessionJob: vi.fn(async () => {
        throw new Error('Job 迁移失败')
      }),
    })
    await settleAgentInterruption(h)
    expect(h.removeSteers).toHaveBeenCalledTimes(1)
    expect(h.finishQueuedTurn).toHaveBeenCalledTimes(1)
    expect(h.applySessionSnapshot).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith(
      '停止任务时清理状态失败：Job 迁移失败',
      'error',
    )
  })

  it('★★ remove steers 抛错仍继续 finish / UI 收口并 notify', async () => {
    const h = input({
      removeSteers: vi.fn(async () => {
        throw new Error('steer 清理失败')
      }),
    })
    await settleAgentInterruption(h)
    expect(h.finishQueuedTurn).toHaveBeenCalledTimes(1)
    expect(h.applySessionSnapshot).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith(
      '停止任务时清理状态失败：steer 清理失败',
      'error',
    )
  })

  it('★★ finish queue 抛错仍更新 UI/refs 并 notify', async () => {
    const h = input({
      finishQueuedTurn: vi.fn(async () => {
        throw new Error('队列销项失败')
      }),
    })
    await settleAgentInterruption(h)
    expect(h.deletePerSessionRefs).toHaveBeenCalledTimes(1)
    expect(h.setStatus).toHaveBeenCalledWith(session.id, {
      kind: 'idle',
    })
    expect(h.notify).toHaveBeenCalledWith(
      '停止任务时清理状态失败：队列销项失败',
      'error',
    )
  })

  it('★★ 非当前界面不 setMessages，但 owner 仍更新 refs / snapshot / status', async () => {
    const h = input({
      isCurrentSession: () => false,
    })
    await settleAgentInterruption(h)
    expect(h.setMessages).not.toHaveBeenCalled()
    expect(h.deletePerSessionRefs).toHaveBeenCalledTimes(1)
    expect(h.applySessionSnapshot).toHaveBeenCalledTimes(1)
    expect(h.setStatus).toHaveBeenCalledWith(session.id, {
      kind: 'idle',
    })
  })

  it('★★ 返回 cleanup 合并后的最新 session', async () => {
    const stored = {
      ...session,
      messageRevision: 6,
    }
    const withoutSteers = {
      ...stored,
      pendingSteers: [],
      messageRevision: 7,
    }
    const finished = {
      ...withoutSteers,
      messageRevision: 8,
    }
    const h = input({
      settleSession: vi.fn(async () => stored),
      removeSteers: vi.fn(async () => withoutSteers),
      finishQueuedTurn: vi.fn(async () => finished),
    })
    const result = await settleAgentInterruption(h)
    expect(result).toBe(finished)
    expect(h.applySessionSnapshot).toHaveBeenCalledWith(finished)
  })
})
