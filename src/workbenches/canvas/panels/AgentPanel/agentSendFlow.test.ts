import { describe, expect, it, vi } from 'vitest'
import { runAgentSendFlow } from './agentSendFlow'
import {
  claimSessionActivity,
  isSessionActivityActive,
  releaseSessionActivity,
} from '../../../../features/canvas/agent/sessionActivity'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentController } from '../../../../features/shared/agent/AgentController'

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
      turnId: 'turn-1',
      turnAbort: new AbortController(),
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
      turnId: 'turn-fail',
      turnAbort: new AbortController(),
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

  it('transition 抛错时仍释放锁，并把清理失败显示给用户', async () => {
    const local = { ...session, id: 'session-transition-fails' }
    let status: unknown
    const outcome = await runAgentSendFlow({
      session: local,
      text: '待清理任务',
      controller: {} as never,
      abortRefs: { current: new Map() },
      deliveredSteersRef: { current: new Map() },
      turnId: 'turn-error',
      turnAbort: new AbortController(),
      runTurn: () => Promise.reject(new Error('原业务失败')),
      applySessionSnapshot: vi.fn(),
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setStatusFor: vi.fn((_id, next) => {
        status = next
      }),
      transitionSessionJob: vi.fn(() =>
        Promise.reject(new Error('Job 收口失败')),
      ) as AgentController['transition'],
      queuePump: vi.fn(),
    })

    expect(outcome).toBeUndefined()
    expect(isSessionActivityActive(local.id)).toBe(false)
    expect(status).toMatchObject({ kind: 'error', message: 'Job 收口失败' })
  })

  it('finishQueuedTurn 抛错仍释放锁，且不二次 finish', async () => {
    const local = { ...session, id: 'session-finish-fails' }
    const finishQueuedTurn = vi.fn(() =>
      Promise.reject(new Error('队列销项失败')),
    )
    let status: unknown
    const outcome = await runAgentSendFlow({
      session: local,
      text: '待销项任务',
      controller: { finishQueuedTurn } as never,
      abortRefs: { current: new Map() },
      deliveredSteersRef: { current: new Map() },
      queueTurnId: 'turn-finish-fails',
      turnId: 'turn-finish-fails',
      turnAbort: new AbortController(),
      runTurn: async () => ({
        kind: 'message',
        text: '业务已完成',
        messages: [{ role: 'user', content: '待销项任务' }],
      }),
      applySessionSnapshot: vi.fn(),
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setStatusFor: vi.fn((_id, next) => {
        status = next
      }),
      transitionSessionJob: vi.fn() as AgentController['transition'],
      queuePump: vi.fn(),
    })

    expect(outcome?.kind).toBe('message')
    expect(finishQueuedTurn).toHaveBeenCalledTimes(1)
    expect(isSessionActivityActive(local.id)).toBe(false)
    expect(status).toMatchObject({ kind: 'error', message: '队列销项失败' })
  })

  it('★★ 旧直接回合结束不得释放新的直接回合活动锁', async () => {
    const local = { ...session, id: 'session-direct-token' }
    const setStatusFor = vi.fn()
    await runAgentSendFlow({
      session: local,
      text: '旧回合',
      controller: {} as never,
      abortRefs: { current: new Map() },
      deliveredSteersRef: { current: new Map() },
      turnId: 'turn-old',
      turnAbort: new AbortController(),
      runTurn: async () => {
        releaseSessionActivity(
          local.id,
          undefined,
          'turn-old',
        )
        expect(
          claimSessionActivity(
            local.id,
            undefined,
            'turn-new',
          ),
        ).toBe(true)
        throw new Error('旧回合迟到失败')
      },
      applySessionSnapshot: vi.fn(),
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setStatusFor,
      transitionSessionJob: vi.fn() as AgentController['transition'],
      queuePump: vi.fn(),
    })

    expect(isSessionActivityActive(local.id)).toBe(true)
    expect(setStatusFor).not.toHaveBeenCalled()
    releaseSessionActivity(
      local.id,
      undefined,
      'turn-new',
    )
  })

  it('★★ abort 后 map 已删仍按本回合 controller 收口为 canceled', async () => {
    const local = { ...session, id: 'session-abort-token' }
    const turnAbort = new AbortController()
    turnAbort.abort()
    let status: unknown
    const transitionSessionJob =
      vi.fn() as AgentController['transition']
    await runAgentSendFlow({
      session: local,
      text: '已停止回合',
      controller: {} as never,
      abortRefs: { current: new Map() },
      deliveredSteersRef: { current: new Map() },
      turnId: 'turn-aborted',
      turnAbort,
      runTurn: async () => {
        throw new Error('aborted')
      },
      applySessionSnapshot: vi.fn(),
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setStatusFor: vi.fn((_id, next) => {
        status = next
      }),
      transitionSessionJob,
      queuePump: vi.fn(),
    })

    expect(status).toEqual({ kind: 'idle' })
    expect(transitionSessionJob).toHaveBeenCalledWith(
      local.id,
      'canceled',
      'interrupted',
      {},
      { phase: 'run_send_text' },
      { turnId: 'turn-aborted', queueTurnId: undefined },
    )
  })

  it('confirm / paused 仍保留活动锁，等待既有后续流程', async () => {
    const cases = [
      {
        id: 'session-confirm',
        outcome: {
          kind: 'confirm' as const,
          request: { callId: 'call', name: 'runNode', args: {} },
          messages: [],
        },
      },
      {
        id: 'session-paused',
        outcome: {
          kind: 'stopped' as const,
          reason: '检查点',
          messages: [],
          checkpoint: { kind: 'max_steps' as const, maxSteps: 8, completedSteps: 8 },
        },
      },
    ]
    for (const item of cases) {
      const local = { ...session, id: item.id }
      await runAgentSendFlow({
        session: local,
        text: '等待后续',
        controller: {} as never,
        abortRefs: { current: new Map() },
        deliveredSteersRef: { current: new Map() },
        turnId: item.id,
        turnAbort: new AbortController(),
        runTurn: async () => item.outcome,
        applySessionSnapshot: vi.fn(),
        clearLiveActivitiesFor: vi.fn(),
        clearLiveProcessFor: vi.fn(),
        clearRunTasksFor: vi.fn(),
        setStatusFor: vi.fn(),
        transitionSessionJob: vi.fn() as AgentController['transition'],
        queuePump: vi.fn(),
      })
      expect(isSessionActivityActive(local.id)).toBe(true)
      releaseSessionActivity(local.id)
    }
  })
})
