import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { QueuedAgentTurn } from '../../../../domain/agent/queuedTurn'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type {
  AgentLoopDeps,
  AgentLoopOutcome,
} from '../../agent/agentLoop'
import { AgentToolEffectBlockedError } from '../../../../features/shared/agent/AgentToolEffectLedger'
import {
  runAgentContinuation,
  type AgentContinuationRunInput,
} from './agentContinuationRun'

const messages: ChatMessage[] = [
  {
    role: 'user',
    content: '生成一套方案',
    imageNodeIds: ['node-1', 'node-1', 'node-2'],
  },
  { role: 'assistant', content: '第一段完成' },
]

const queuedTurn: QueuedAgentTurn = {
  id: 'queue-1',
  text: '继续生成',
  createdAt: 1,
  channelId: '',
  model: 'chat-model',
}

const session: AgentSession = {
  id: 'session-continue',
  projectId: 'p1',
  title: '检查点继续',
  channelId: '',
  model: 'chat-model',
  queuedTurns: [],
  pendingSteers: [],
  messages,
  messageRevision: 8,
  continuation: {
    reason: 'max_steps',
    maxSteps: 8,
    createdAt: 2,
  },
  createdAt: 1,
  updatedAt: 2,
}

const initial: AgentLoopOutcome = {
  kind: 'message',
  text: '继续完成',
  messages: [...messages, { role: 'assistant', content: '继续完成' }],
}

function harness(overrides: Partial<AgentContinuationRunInput> = {}) {
  const controller = new AbortController()
  const loopDeps = {
    signal: controller.signal,
  } as AgentLoopDeps
  const value: AgentContinuationRunInput = {
    session,
    messages,
    activeQueueTurnId: () => undefined,
    currentTurnId: () => 'turn-current',
    turnOrigin: vi.fn((turnId, queueTurnId) => ({
      jobId: 'job-1',
      turnId,
      queueTurnId,
      messageRevision: 8,
    })),
    isActivityActive: () => false,
    claimNextQueuedTurn: vi.fn(async () => null),
    claimActivity: vi.fn(() => true),
    applySessionSnapshot: vi.fn(),
    ensureRoute: vi.fn(async () => ({
      ok: true as const,
      route: {} as never,
    })),
    createLoopDeps: vi.fn(() => loopDeps),
    toolMode: () => 'native',
    turnTools: () => [],
    transitionSessionJob: vi.fn(async () => null),
    setAbortController: vi.fn(),
    setStatus: vi.fn(),
    runAgentTurn: vi.fn(async () => initial),
    continueAutoConfirmations: vi.fn(async () => initial),
    handleOutcome: vi.fn(async () => 'applied' as const),
    settleSessionOutcome: vi.fn(async () => {}),
    isCurrentSession: () => true,
    setMessages: vi.fn(),
    createAbortController: () => controller,
  }
  return {
    controller,
    loopDeps,
    input: { ...value, ...overrides },
  }
}

describe('runAgentContinuation', () => {
  it('★★ 已有活动锁时直接复用，不重新领取队列', async () => {
    const h = harness({
      activeQueueTurnId: () => 'queue-live',
      isActivityActive: () => true,
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('applied')
    expect(h.input.claimNextQueuedTurn).not.toHaveBeenCalled()
    expect(h.input.claimActivity).not.toHaveBeenCalled()
    expect(h.input.ensureRoute).toHaveBeenCalledWith(session)
    expect(h.input.turnOrigin).toHaveBeenCalledWith(
      'queue-live',
      'queue-live',
    )
  })

  it('★★ 重载后检查点继续先重新准备路由，失败时不创建 loopDeps/请求模型', async () => {
    const h = harness({
      ensureRoute: vi.fn(async () => ({
        ok: false as const,
        message: '没有可用的模型服务提供「chat-model」',
      })),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('failed')
    expect(h.input.ensureRoute).toHaveBeenCalledWith(session)
    expect(h.input.createLoopDeps).not.toHaveBeenCalled()
    expect(h.input.runAgentTurn).not.toHaveBeenCalled()
    const errorOutcome = {
      kind: 'error' as const,
      message: '没有可用的模型服务提供「chat-model」',
      messages,
      phase: 'continuation_route',
    }
    expect(h.input.handleOutcome).toHaveBeenCalledWith(
      session,
      errorOutcome,
      undefined,
      h.controller,
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      errorOutcome,
      expect.objectContaining({ messageRevision: 8 }),
    )
  })

  it('★★ 路由准备抛错时复用 error outcome 收口，不创建 loopDeps/请求模型', async () => {
    const h = harness({
      ensureRoute: vi.fn(async () => {
        throw new Error('路由端口异常')
      }),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('failed')
    expect(h.input.createLoopDeps).not.toHaveBeenCalled()
    expect(h.input.runAgentTurn).not.toHaveBeenCalled()
    const errorOutcome = {
      kind: 'error' as const,
      message: '路由端口异常',
      messages,
      phase: 'continuation_route',
    }
    expect(h.input.handleOutcome).toHaveBeenCalledWith(
      session,
      errorOutcome,
      undefined,
      h.controller,
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      errorOutcome,
      expect.objectContaining({ messageRevision: 8 }),
    )
  })

  it('★★ 路由失败收口返回 conflict 时不伪报 failed', async () => {
    const h = harness({
      ensureRoute: vi.fn(async () => ({
        ok: false as const,
        message: '路由已失效',
      })),
      handleOutcome: vi.fn(async () => 'conflict' as const),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('conflict')
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        kind: 'error',
        message: '路由已失效',
      }),
      expect.objectContaining({ messageRevision: 8 }),
    )
  })

  it('★★ 路由失败时 outcome 收口抛错仍释放活动锁并转失败', async () => {
    const h = harness({
      ensureRoute: vi.fn(async () => ({
        ok: false as const,
        message: '路由已失效',
      })),
      handleOutcome: vi.fn(async () => {
        throw new Error('检查点写库失败')
      }),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('failed')
    expect(h.input.transitionSessionJob).toHaveBeenCalledWith(
      session.id,
      'failed',
      'failed',
      { lastError: '路由已失效' },
      { phase: 'continuation_route' },
      expect.objectContaining({ messageRevision: 8 }),
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalled()
    expect(h.input.setStatus).toHaveBeenCalledWith({
      kind: 'error',
      message: expect.stringContaining('检查点写库失败'),
    })
  })

  it('★★ 无活动锁时用现有 direct turnId 领取一次活动锁', async () => {
    const h = harness({
      currentTurnId: () => 'turn-direct',
    })

    await runAgentContinuation(h.input)

    expect(h.input.claimNextQueuedTurn).not.toHaveBeenCalled()
    expect(h.input.claimActivity).toHaveBeenCalledWith(
      session.id,
      undefined,
      'turn-direct',
    )
    expect(h.input.applySessionSnapshot).not.toHaveBeenCalled()
    expect(h.input.turnOrigin).toHaveBeenCalledWith(
      'turn-direct',
      undefined,
    )
  })

  /**
   * #929-③：抢锁失败这条必须**立刻退出**。
   *
   * 若漏掉 `return 'busy'`：两个回合会并发写同一会话（双倍扣费 + 历史重复）。
   * 所以这里断的是"后面每一步都没发生"，而不是"返回值是 busy"这么一句。
   */
  it('★★ 抢锁失败返回 busy：后续一步都不许跑', async () => {
    const h = harness({ claimActivity: vi.fn(() => false) })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('busy')
    expect(h.input.claimActivity).toHaveBeenCalledWith(
      session.id,
      undefined,
      'turn-current',
    )
    // 不许准备路由 / 建 loopDeps / 请求模型 / 迁 Job / 写状态 / 收口
    expect(h.input.ensureRoute).not.toHaveBeenCalled()
    expect(h.input.createLoopDeps).not.toHaveBeenCalled()
    expect(h.input.runAgentTurn).not.toHaveBeenCalled()
    expect(h.input.transitionSessionJob).not.toHaveBeenCalled()
    expect(h.input.setStatus).not.toHaveBeenCalled()
    expect(h.input.settleSessionOutcome).not.toHaveBeenCalled()
    expect(h.input.setAbortController).not.toHaveBeenCalled()
  })

  it('★★ 队列检查点先领取队首并把 queue / turn 绑定到同一活动锁', async () => {
    const queuedSession: AgentSession = {
      ...session,
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 2,
        queuedTurnId: queuedTurn.id,
      },
      queuedTurns: [queuedTurn],
    }
    const claimedSession: AgentSession = {
      ...queuedSession,
      activeTurnId: queuedTurn.id,
      queuedTurns: [],
    }
    const h = harness({
      session: queuedSession,
      claimNextQueuedTurn: vi.fn(async () => ({
        session: claimedSession,
        turn: queuedTurn,
      })),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('applied')
    expect(h.input.claimNextQueuedTurn).toHaveBeenCalledWith(session.id)
    expect(h.input.applySessionSnapshot).toHaveBeenCalledWith(claimedSession)
    expect(h.input.claimActivity).toHaveBeenCalledWith(
      session.id,
      queuedTurn.id,
      queuedTurn.id,
    )
    expect(h.input.turnOrigin).toHaveBeenCalledWith(
      queuedTurn.id,
      queuedTurn.id,
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      initial,
      expect.objectContaining({
        turnId: queuedTurn.id,
        queueTurnId: queuedTurn.id,
      }),
    )
  })

  it('★★ outcome 冲突时仍用本回合 origin 结算，不伪造成功 UI', async () => {
    const h = harness({
      handleOutcome: vi.fn(async () => 'conflict' as const),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('conflict')
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      initial,
      {
        jobId: 'job-1',
        turnId: 'turn-current',
        queueTurnId: undefined,
        messageRevision: 8,
      },
    )
  })

  it('★★ 本回合 abort 后不写错误态或结算', async () => {
    const h = harness()
    h.input.runAgentTurn = vi.fn(async () => {
      h.controller.abort()
      throw new Error('aborted')
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('aborted')
    expect(h.input.setStatus).toHaveBeenCalledTimes(1)
    expect(h.input.setStatus).toHaveBeenCalledWith({ kind: 'thinking' })
    expect(h.input.settleSessionOutcome).not.toHaveBeenCalled()
  })

  it('★★ 非 abort 错误写入可见错误态，并按原 origin 结算失败', async () => {
    const failure = new Error('模型请求失败')
    const h = harness({
      runAgentTurn: vi.fn(async () => {
        throw failure
      }),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('failed')
    expect(h.input.setStatus).toHaveBeenCalledWith({
      kind: 'error',
      message: '模型请求失败',
    })
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      { kind: 'error' },
      {
        jobId: 'job-1',
        turnId: 'turn-current',
        queueTurnId: undefined,
        messageRevision: 8,
      },
    )
  })

  it('★★ 自动确认使用第一次 run 的同一 loopDeps，并先发过程消息再收口', async () => {
    const progress = [
      ...messages,
      { role: 'assistant' as const, content: '自动确认继续' },
    ]
    const final = { ...initial, messages: progress }
    const h = harness({
      continueAutoConfirmations: vi.fn(async (
        _session,
        start,
        deps,
        onMessages,
      ) => {
        expect(start).toBe(initial)
        expect(deps).toBe(h.loopDeps)
        onMessages(progress)
        return final
      }),
    })

    await runAgentContinuation(h.input)

    expect(h.input.setMessages).toHaveBeenCalledWith(progress)
    expect(h.input.handleOutcome).toHaveBeenCalledWith(
      session,
      final,
      undefined,
      h.controller,
    )
  })

  it('★★ 后台会话的过程消息只更新持久回写端口之外的状态，不覆盖当前界面', async () => {
    const progress = [
      ...messages,
      { role: 'assistant' as const, content: '后台继续' },
    ]
    const h = harness({
      isCurrentSession: () => false,
      continueAutoConfirmations: vi.fn(async (
        _session,
        _initial,
        _deps,
        onMessages,
      ) => {
        onMessages(progress)
        return { ...initial, messages: progress }
      }),
    })

    await runAgentContinuation(h.input)

    expect(h.input.setMessages).not.toHaveBeenCalled()
  })

  /**
   * #922：`continueAgentAutoConfirmations` 先把 Job 推进到
   * `waiting_generation + pendingCallId`，随后 `executeConfirmedTool`（账本拒绝）或
   * `finishConfirmedTool` 抛错。这条 catch 以前**只收活动锁、不迁 Job** ⇒ Job 永远停在
   * `waiting_generation`，而内存 `jobIds` 映射还在，下一次发送会被 `ensureJob` 当成
   * 同回合 Job 静默复用，把「这次生成可能已扣费」的标记带过去。
   */
  function blockedByLedger() {
    const reason =
      '上一次同名工具已经开始执行，但应用没有收到完成结果。为避免重复写画布或重复扣费，本次不会自动重发。'
    return new AgentToolEffectBlockedError(reason, 'needs_attention', {
      kind: 'pending',
      reason,
      effect: {
        effectKey: 'agent:job-1:unplanned:call-1',
        stepId: 'unplanned',
        toolCallId: 'call-1',
        toolName: 'runNode',
        argsDigest: 'digest',
        state: 'started',
        startedAt: 1,
      },
    })
  }

  /** 带状态的 Job 桩：从 `waiting_generation` 起，转态即改写状态，便于断言终态。 */
  function stuckJob() {
    const state = {
      status: 'waiting_generation' as string,
      pendingCallId: 'call-1' as string | undefined,
    }
    const transitionSessionJob = vi.fn(
      async (
        _sessionId: string,
        to: string,
        _eventType?: string,
        patch?: { pendingCallId?: string },
      ) => {
        state.status = to
        if (patch && 'pendingCallId' in patch) {
          state.pendingCallId = patch.pendingCallId
        }
        return { job: { ...state } } as never
      },
    )
    return { state, transitionSessionJob }
  }

  it('★★ 续跑中途账本拒绝：Job 必须离开 waiting_generation 并落到 needs_attention', async () => {
    const { state, transitionSessionJob } = stuckJob()
    const h = harness({
      transitionSessionJob,
      continueAutoConfirmations: vi.fn(async () => {
        // 模拟 `agentAutoConfirmations.ts:71-79` 已经把 Job 推进到等待生成
        state.status = 'waiting_generation'
        state.pendingCallId = 'call-1'
        throw blockedByLedger()
      }),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('failed')
    expect(transitionSessionJob).toHaveBeenCalledWith(
      session.id,
      'needs_attention',
      'tool_failed',
      expect.objectContaining({
        pendingCallId: 'call-1',
        lastError: expect.stringContaining('没有收到完成结果'),
      }),
      { phase: 'continued_turn' },
      expect.objectContaining({ jobId: 'job-1', turnId: 'turn-current' }),
    )
    expect(state.status).not.toBe('waiting_generation')
    expect(state.status).toBe('needs_attention')
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      { kind: 'error' },
      expect.objectContaining({ jobId: 'job-1' }),
    )
  })

  it('★★ 续跑中途其它错误：Job 落 failed，且不伪造 pendingCallId', async () => {
    const { state, transitionSessionJob } = stuckJob()
    const h = harness({
      transitionSessionJob,
      continueAutoConfirmations: vi.fn(async () => {
        state.status = 'waiting_generation'
        state.pendingCallId = 'call-1'
        throw new Error('收口失败')
      }),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('failed')
    const lastCall =
      transitionSessionJob.mock.calls.at(-1) as unknown as unknown[]
    expect(lastCall[1]).toBe('failed')
    expect(lastCall[2]).toBe('failed')
    expect(lastCall[3]).toEqual({ lastError: '收口失败' })
    expect(lastCall[3]).not.toHaveProperty('pendingCallId')
    expect(state.status).toBe('failed')
    expect(state.status).not.toBe('waiting_generation')
  })

  it('★★ Job 转态自己抛错时仍收口活动锁，并把失败并进可见文案', async () => {
    const h = harness({
      // 只让**失败收口**那次转态抛错；进入循环前的 planning 转态照常成功
      transitionSessionJob: vi.fn(
        async (_sessionId: string, to: string) => {
          if (to === 'planning') return { job: {} } as never
          throw new Error('job store 写失败')
        },
      ),
      continueAutoConfirmations: vi.fn(async () => {
        throw blockedByLedger()
      }),
    })

    const result = await runAgentContinuation(h.input)

    expect(result).toBe('failed')
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      { kind: 'error' },
      expect.objectContaining({ jobId: 'job-1' }),
    )
    expect(h.input.setStatus).toHaveBeenLastCalledWith({
      kind: 'error',
      message: expect.stringContaining('Job 转态失败'),
    })
  })
})
