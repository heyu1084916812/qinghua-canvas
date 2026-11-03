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
    expect(h.input.createLoopDeps).toHaveBeenCalledWith({
      session,
      operationId: expect.stringMatching(/^op_/),
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
})
