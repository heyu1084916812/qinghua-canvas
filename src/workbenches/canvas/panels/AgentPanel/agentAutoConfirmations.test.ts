import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopDeps, AgentLoopOutcome } from '../../agent/agentLoop'
import {
  continueAgentAutoConfirmations,
  type AgentAutoConfirmationInput,
} from './agentAutoConfirmations'

const session: AgentSession = {
  id: 'session-auto',
  projectId: 'p1',
  title: '自动确认',
  channelId: '',
  model: 'chat-model',
  queuedTurns: [],
  pendingSteers: [],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

const controller = new AbortController()
const loopDeps = {
  signal: controller.signal,
} as AgentLoopDeps

function confirmOutcome(
  name: string,
  args: Record<string, unknown> = {},
): AgentLoopOutcome {
  return {
    kind: 'confirm',
    request: {
      callId: `call-${name}`,
      name,
      args,
    },
    messages: [{ role: 'assistant', content: '' }],
  }
}

function input(
  initial: AgentLoopOutcome,
  overrides: Partial<AgentAutoConfirmationInput> = {},
): AgentAutoConfirmationInput {
  return {
    session,
    initial,
    loopDeps,
    autoRun: () => true,
    maxSteps: 32,
    turnOrigin: () => ({
      jobId: 'job-1',
      turnId: 'turn-1',
      queueTurnId: 'queue-1',
    }),
    transitionSessionJob: vi.fn(async () => null),
    executeConfirmedTool: vi.fn(async () => ({ ok: true })),
    finishConfirmedTool: vi.fn(async () => {}),
    onMessages: vi.fn(),
    setStatus: vi.fn(),
    resumeAgentTurn: vi.fn(
      async (): Promise<AgentLoopOutcome> => ({
        kind: 'message',
        text: '完成',
        messages: [],
      }),
    ),
    ...overrides,
  }
}

describe('continueAgentAutoConfirmations', () => {
  it('★★ 手动模式直接返回 confirm，不执行工具', async () => {
    const initial = confirmOutcome('runNode')
    const args = input(initial, { autoRun: () => false })
    const result = await continueAgentAutoConfirmations(args)
    expect(result).toBe(initial)
    expect(args.transitionSessionJob).not.toHaveBeenCalled()
    expect(args.executeConfirmedTool).not.toHaveBeenCalled()
  })

  it('★★ 显式批准工具在自动模式仍返回 confirm', async () => {
    const initial = confirmOutcome('deleteNodes', {
      nodeIds: ['node-1'],
    })
    const args = input(initial)
    const result = await continueAgentAutoConfirmations(args)
    expect(result).toBe(initial)
    expect(args.transitionSessionJob).not.toHaveBeenCalled()
    expect(args.executeConfirmedTool).not.toHaveBeenCalled()
  })

  it('★★ 生成工具保持 transition → execute → finish → resume 顺序', async () => {
    const order: string[] = []
    const initial = confirmOutcome('runNode', {
      nodeIds: ['node-1'],
    })
    const seenDeps: AgentLoopDeps[] = []
    const args = input(initial, {
      transitionSessionJob: vi.fn(async () => {
        order.push('transition')
        return null
      }),
      executeConfirmedTool: vi.fn(async () => {
        order.push('execute')
        return { ok: true }
      }),
      finishConfirmedTool: vi.fn(async () => {
        order.push('finish')
      }),
      onMessages: vi.fn(() => {
        order.push('messages')
      }),
      setStatus: vi.fn(() => {
        order.push('status')
      }),
      resumeAgentTurn: vi.fn(
        async (
          _messages,
          _callId,
          _done,
          deps,
        ): Promise<AgentLoopOutcome> => {
          order.push('resume')
          seenDeps.push(deps)
          return { kind: 'message', text: '完成', messages: [] }
        },
      ),
    })

    const result = await continueAgentAutoConfirmations(args)

    expect(result.kind).toBe('message')
    expect(order).toEqual([
      'transition',
      'status',
      'execute',
      'messages',
      'finish',
      'resume',
    ])
    expect(seenDeps).toEqual([loopDeps])
    expect((seenDeps[0] as AgentLoopDeps).signal).toBe(controller.signal)
    expect(args.transitionSessionJob).toHaveBeenCalledWith(
      session.id,
      'waiting_generation',
      'generation_started',
      { pendingCallId: 'call-runNode' },
      { tool: 'runNode', auto: true },
      { jobId: 'job-1', turnId: 'turn-1', queueTurnId: 'queue-1' },
    )
  })

  it('★★ 非生成自动工具不转 waiting_generation，也不 finish', async () => {
    const initial = confirmOutcome('requestTaskConfirmation', {
      purpose: 'review',
      stepId: 'step-1',
    })
    const args = input(initial)
    const result = await continueAgentAutoConfirmations(args)
    expect(result.kind).toBe('message')
    expect(args.transitionSessionJob).not.toHaveBeenCalled()
    expect(args.executeConfirmedTool).toHaveBeenCalledTimes(1)
    expect(args.onMessages).toHaveBeenCalledWith(initial.messages)
    expect(args.finishConfirmedTool).not.toHaveBeenCalled()
  })

  it('★★ 达到 maxSteps 返回原安全的 max_steps 检查点文案', async () => {
    const args = input(confirmOutcome('requestTaskConfirmation', {
      purpose: 'review',
    }), {
      maxSteps: 2,
      resumeAgentTurn: vi.fn(async () =>
        confirmOutcome('requestTaskConfirmation', { purpose: 'review' })),
    })
    const result = await continueAgentAutoConfirmations(args)
    expect(result).toMatchObject({
      kind: 'stopped',
      reason:
        '自动执行已连续完成 2 个动作，已安全暂停；点击“继续任务”可接着执行，不会把下一步变成新的付费确认卡。',
      checkpoint: {
        kind: 'max_steps',
        maxSteps: 2,
        completedSteps: 2,
      },
    })
    expect(args.executeConfirmedTool).toHaveBeenCalledTimes(2)
  })

  it('★★ 执行抛错原样抛出，不吞掉也不继续 resume', async () => {
    const failure = new Error('工具执行失败')
    const args = input(confirmOutcome('runNode'), {
      executeConfirmedTool: vi.fn(async () => {
        throw failure
      }),
    })
    await expect(continueAgentAutoConfirmations(args)).rejects.toBe(failure)
    expect(args.onMessages).not.toHaveBeenCalled()
    expect(args.finishConfirmedTool).not.toHaveBeenCalled()
    expect(args.resumeAgentTurn).not.toHaveBeenCalled()
  })
})
