import { describe, expect, it, vi } from 'vitest'
import { runAgentSendFlow } from './agentSendFlow'
import {
  claimSessionActivity,
  isSessionActivityActive,
} from '../../../../features/canvas/agent/sessionActivity'
import type { AgentSession } from '../../../../state/agent/sessionStore'

const session: AgentSession = {
  id: 'session-flow',
  projectId: 'p1',
  title: '流程',
  channelId: '',
  model: 'm1',
  queuedTurns: [],
  pendingSteers: [],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

describe('runAgentSendFlow', () => {
  it('队列发送完成后释放活动锁并标记队首完成', async () => {
    expect(claimSessionActivity(session.id, 'turn-1')).toBe(true)
    const finished: unknown[][] = []
    const next = { ...session }
    let pumped = false

    const outcome = await runAgentSendFlow({
      session,
      text: '下一轮任务',
      controller: {
        finishQueuedTurn: vi.fn(async (...args: unknown[]) => {
          finished.push(args)
          return next
        }),
      } as never,
      abortRefs: { current: new Map() },
      deliveredSteersRef: { current: new Map() },
      preclaimed: true,
      queueTurnId: 'turn-1',
      runTurn: async () => ({
        kind: 'message',
        text: '已完成',
        messages: [{ role: 'user', content: '下一轮任务' }],
      }),
      applySessionSnapshot: vi.fn(),
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setStatusFor: vi.fn(),
      transitionSessionJob: vi.fn(),
      queuePump: () => {
        pumped = true
      },
    })

    expect(outcome?.kind).toBe('message')
    expect(finished).toEqual([[session.id, 'turn-1', true]])
    expect(isSessionActivityActive(session.id)).toBe(false)
    expect(pumped).toBe(false)
  })

  it('空结果也释放队列锁，不把未发送消息伪装成已完成', async () => {
    expect(claimSessionActivity(session.id, 'turn-fail')).toBe(true)
    const finished: unknown[][] = []
    await runAgentSendFlow({
      session,
      text: '请求未发送',
      controller: {
        finishQueuedTurn: vi.fn(async (...args: unknown[]) => {
          finished.push(args)
          return { ...session }
        }),
      } as never,
      abortRefs: { current: new Map() },
      deliveredSteersRef: { current: new Map() },
      preclaimed: true,
      queueTurnId: 'turn-fail',
      runTurn: async () => undefined,
      applySessionSnapshot: vi.fn(),
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setStatusFor: vi.fn(),
      transitionSessionJob: vi.fn(),
      queuePump: vi.fn(),
    })

    expect(finished).toEqual([[session.id, 'turn-fail', false]])
    expect(isSessionActivityActive(session.id)).toBe(false)
  })
})
