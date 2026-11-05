import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import type { AgentTurnOrigin } from '../../../../features/shared/agent/AgentController'
import {
  AgentToolEffectBlockedError,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type {
  AgentLoopDeps,
  AgentLoopOutcome,
} from '../../agent/agentLoop'
import {
  runAgentConfirmation,
  type AgentConfirmationRunInput,
} from './agentConfirmationRun'

const messages: ChatMessage[] = [
  {
    role: 'user',
    content: '运行这张图',
    imageNodeIds: ['node-1', 'node-1', 'node-2'],
  },
  {
    role: 'assistant',
    content: '',
    toolCalls: [{
      id: 'call-run',
      name: 'runNode',
      args: '{"nodeIds":["node-1"]}',
    }],
  },
]

const session: AgentSession = {
  id: 'session-confirm',
  projectId: 'p1',
  title: '确认执行',
  channelId: '',
  model: 'chat-model',
  queuedTurns: [],
  pendingSteers: [],
  messages,
  messageRevision: 7,
  createdAt: 1,
  updatedAt: 1,
}

const request: AgentToolRequest = {
  callId: 'call-run',
  name: 'runNode',
  args: { nodeIds: ['node-1'] },
}

const origin: AgentTurnOrigin = {
  jobId: 'job-1',
  turnId: 'queue-1',
  queueTurnId: 'queue-1',
  messageRevision: 7,
}

const resumed: AgentLoopOutcome = {
  kind: 'message',
  text: '已完成',
  messages: [...messages, { role: 'assistant', content: '已完成' }],
}

function harness(overrides: Partial<AgentConfirmationRunInput> = {}) {
  const controller = new AbortController()
  const loopDeps = {
    signal: controller.signal,
  } as AgentLoopDeps
  const value: AgentConfirmationRunInput = {
    session,
    request,
    messages,
    turnOrigin: vi.fn(() => origin),
    beginConfirmation: vi.fn(async () => {}),
    finishConfirmedTool: vi.fn(async () => {}),
    executeConfirmedTool: vi.fn(async () => ({ ok: true })),
    ensureRoute: vi.fn(async () => ({
      ok: true as const,
      route: {} as never,
    })),
    createLoopDeps: vi.fn(() => loopDeps),
    toolMode: () => 'native',
    turnTools: () => [],
    resumeAgentTurn: vi.fn(async () => resumed),
    continueAutoConfirmations: vi.fn(async () => resumed),
    handleOutcome: vi.fn(async () => 'applied' as const),
    settleSessionOutcome: vi.fn(async () => {}),
    transitionSessionJob: vi.fn(async () => null),
    setAbortController: vi.fn(),
    setStatus: vi.fn(),
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

describe('runAgentConfirmation', () => {
  it('★★ 确认执行保持 begin → execute → finish → resume → outcome 收口顺序', async () => {
    const order: string[] = []
    const h = harness({
      beginConfirmation: vi.fn(async () => {
        order.push('begin')
      }),
      executeConfirmedTool: vi.fn(async () => {
        order.push('execute')
        return { ok: true }
      }),
      ensureRoute: vi.fn(async () => {
        order.push('route')
        return { ok: true as const, route: {} as never }
      }),
      createLoopDeps: vi.fn(() => {
        order.push('deps')
        return h.loopDeps
      }),
      finishConfirmedTool: vi.fn(async () => {
        order.push('finish')
      }),
      setStatus: vi.fn((status) => {
        order.push(`status:${status.kind}`)
      }),
      resumeAgentTurn: vi.fn(async () => {
        order.push('resume')
        return resumed
      }),
      continueAutoConfirmations: vi.fn(async () => {
        order.push('auto')
        return resumed
      }),
      handleOutcome: vi.fn(async () => {
        order.push('outcome')
        return 'applied' as const
      }),
      settleSessionOutcome: vi.fn(async () => {
        order.push('settle')
      }),
    })

    const result = await runAgentConfirmation(h.input)

    expect(result).toBe('applied')
    expect(order).toEqual([
      'begin',
      'status:executing',
      'execute',
      'route',
      'deps',
      'finish',
      'status:thinking',
      'resume',
      'auto',
      'outcome',
      'settle',
    ])
    expect(h.input.beginConfirmation).toHaveBeenCalledWith(
      session.id,
      request,
      origin,
    )
    expect(h.input.finishConfirmedTool).toHaveBeenCalledWith(
      session.id,
      request,
      origin,
    )
    expect(h.input.ensureRoute).toHaveBeenCalledWith(session)
    expect(h.input.createLoopDeps).toHaveBeenCalledWith({
      session,
      operationId: expect.stringMatching(/^op_/),
      route: expect.any(Object),
      toolMode: 'native',
      visualNodeIds: ['node-1', 'node-2'],
      turnTools: [],
      turnController: h.controller,
    })
    expect(h.input.handleOutcome).toHaveBeenCalledWith(
      session,
      resumed,
      undefined,
      h.controller,
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      resumed,
      origin,
    )
  })

  it('★★ 确认执行后路由失效时先重建，不允许拿空渠道续跑', async () => {
    const h = harness({
      ensureRoute: vi.fn(async () => ({
        ok: false as const,
        message: '没有可用的模型服务提供「chat-model」',
      })),
    })

    const result = await runAgentConfirmation(h.input)

    expect(result).toBe('failed')
    expect(h.input.ensureRoute).toHaveBeenCalledWith(session)
    expect(h.input.createLoopDeps).not.toHaveBeenCalled()
    expect(h.input.resumeAgentTurn).not.toHaveBeenCalled()
    expect(h.input.setStatus).toHaveBeenCalledWith({
      kind: 'error',
      message: '没有可用的模型服务提供「chat-model」',
    })
    expect(h.input.transitionSessionJob).toHaveBeenCalledWith(
      session.id,
      'failed',
      'failed',
      { lastError: '没有可用的模型服务提供「chat-model」' },
      { phase: 'confirmed_tool' },
      origin,
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      { kind: 'error' },
      origin,
    )
  })

  it('★★ 自动续跑复用同一 loopDeps，且只在当前会话写消息', async () => {
    const progress = [
      ...messages,
      { role: 'assistant' as const, content: '正在继续' },
    ]
    const final = {
      ...resumed,
      messages: progress,
    }
    let current = true
    const h = harness({
      isCurrentSession: () => current,
      continueAutoConfirmations: vi.fn(async (
        _session,
        _initial,
        deps,
        onMessages,
      ) => {
        expect(deps).toBe(h.loopDeps)
        onMessages(progress)
        return final
      }),
    })

    await runAgentConfirmation(h.input)
    expect(h.input.setMessages).toHaveBeenCalledWith(progress)

    current = false
    await runAgentConfirmation(h.input)
    expect(h.input.setMessages).toHaveBeenCalledTimes(1)
  })

  it('★★ message outcome revision 冲突仍按本回合 origin 结算，不迁失败 Job', async () => {
    const h = harness({
      handleOutcome: vi.fn(async () => 'conflict' as const),
    })

    const result = await runAgentConfirmation(h.input)

    expect(result).toBe('conflict')
    expect(h.input.transitionSessionJob).not.toHaveBeenCalled()
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      resumed,
      origin,
    )
  })

  it('★★ 本回合 abort 后不再写错误态、Job 或结算', async () => {
    const h = harness()
    const failure = new Error('aborted')
    h.input.resumeAgentTurn = vi.fn(async () => {
      h.controller.abort()
      throw failure
    })

    const result = await runAgentConfirmation(h.input)

    expect(result).toBe('aborted')
    expect(h.input.setStatus).not.toHaveBeenCalledWith({
      kind: 'error',
      message: 'aborted',
    })
    expect(h.input.transitionSessionJob).not.toHaveBeenCalled()
    expect(h.input.settleSessionOutcome).not.toHaveBeenCalled()
  })

  it('★★ 工具副作用未决时保持 needs_attention Job 与 pendingCallId', async () => {
    const blocked = new AgentToolEffectBlockedError(
      '无法确认工具是否已经生效',
      'needs_attention',
      {
        kind: 'pending',
        reason: '无法确认工具是否已经生效',
        effect: {
          effectKey: 'effect-1',
          stepId: 'unplanned',
          toolCallId: request.callId,
          toolName: request.name,
          argsDigest: 'digest',
          state: 'started',
          startedAt: 1,
        },
      },
    )
    const h = harness({
      executeConfirmedTool: vi.fn(async () => {
        throw blocked
      }),
    })

    const result = await runAgentConfirmation(h.input)

    expect(result).toBe('needs_attention')
    expect(h.input.transitionSessionJob).toHaveBeenCalledWith(
      session.id,
      'needs_attention',
      'tool_failed',
      {
        lastError: blocked.message,
        pendingCallId: request.callId,
      },
      { phase: 'confirmed_tool' },
      origin,
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      { kind: 'error' },
      origin,
    )
  })

  it('★★ beginConfirmation 迁移失败转 failed Job，并保留原 origin', async () => {
    const failure = new Error('Job 迁移失败')
    const h = harness({
      beginConfirmation: vi.fn(async () => {
        throw failure
      }),
    })

    const result = await runAgentConfirmation(h.input)

    expect(result).toBe('failed')
    expect(h.input.setStatus).toHaveBeenCalledWith({
      kind: 'error',
      message: 'Job 迁移失败',
    })
    expect(h.input.transitionSessionJob).toHaveBeenCalledWith(
      session.id,
      'failed',
      'failed',
      { lastError: 'Job 迁移失败' },
      { phase: 'confirmed_tool' },
      origin,
    )
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      { kind: 'error' },
      origin,
    )
  })

  /**
   * #916：**Job 转态自己抛错**时，收口也不能停在那一步。
   *
   * `settleSessionOutcome` 才是释放内存活动锁（`releaseSessionActivity`）的地方。
   * 以前 `transitionSessionJob` 没有兜底：store 写失败 / 生命周期已关闭导致它抛错时，
   * 后面那行 settle 根本不会执行 ⇒ 该会话的活动锁永远归不了零 ⇒ 之后发消息、排队、
   * 续跑全被判 busy（`claimSessionActivity` 恒 false），而 error 态下停止按钮**不渲染**，
   * 面板内没有手动恢复入口。
   *
   * 对照 `agentContinuationRun` 的 `failRoute`：那里 transition 是显式包了 try/catch 的。
   */
  it('★★ Job 转态抛错时仍然执行活动锁收口，并把错误并进状态文案', async () => {
    const failure = new Error('复核失败')
    const transitionFailure = new Error('store 写失败')
    const h = harness({
      beginConfirmation: vi.fn(async () => {
        throw failure
      }),
      transitionSessionJob: vi.fn(async () => {
        throw transitionFailure
      }),
    })

    const result = await runAgentConfirmation(h.input)

    // ① 活动锁收口必须照常执行（它是唯一释放内存锁的一步）
    expect(h.input.settleSessionOutcome).toHaveBeenCalledWith(
      session.id,
      { kind: 'error' },
      origin,
    )
    // ② 状态必须可见：先摆原始失败，再把「Job 转态失败」并进去 —— 两条都不许吞
    const statuses = vi.mocked(h.input.setStatus).mock.calls.map(
      (call) => call[0],
    )
    expect(statuses[0]).toEqual({
      kind: 'error',
      message: '复核失败',
    })
    const last = statuses[statuses.length - 1] as {
      kind: string
      message: string
    }
    expect(last.kind).toBe('error')
    expect(last.message).toContain('复核失败')
    expect(last.message).toContain('Job 转态失败')
    expect(last.message).toContain('store 写失败')
    // ③ 失败语义不变
    expect(result).toBe('failed')
  })
})
