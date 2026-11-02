import { describe, expect, it, vi } from 'vitest'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentToolName } from '../../../../domain/agent/toolRegistry'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopOutcome } from '../../agent/agentLoop'
import { IDLE_STATUS } from './AgentActivityViews'
import {
  coordinateAgentOutcome,
  type CoordinateAgentOutcomeInput,
} from './agentOutcomeCoordinator'

const SESSION: AgentSession = {
  id: 'session-outcome',
  projectId: 'p1',
  title: '结果收口',
  channelId: '',
  model: 'chat-model',
  queuedTurns: [],
  pendingSteers: [],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function harness(args: {
  outcome: AgentLoopOutcome
  controller?: AbortController
  currentController?: () => AbortController | undefined
  currentSessionId?: string | null
  toolNames?: readonly AgentToolName[]
  deliveredSteers?: readonly string[]
  activeQueuedTurnId?: string
  updateFields?: CoordinateAgentOutcomeInput['sessions']['updateFields']
}) {
  const controller = args.controller ?? new AbortController()
  let currentController = controller
  const settleInterruptedConfirmation = vi.fn(
    async (
      _sessionId: string,
      _request: {
        callId: string
        name: string
      },
    ) => null,
  )
  const removeSteers = vi.fn(async () => ({ ...SESSION }))
  const updateFields =
    args.updateFields ??
    vi.fn(async (_id: string, patch: Partial<AgentSession>) => ({
      ...SESSION,
      ...patch,
    }))
  const transitionMock = vi.fn(
    async () => null,
  )
  const input: CoordinateAgentOutcomeInput = {
    session: SESSION,
    outcome: args.outcome,
    outcomeController: controller,
    currentOutcomeController: () =>
      args.currentController
        ? args.currentController()
        : currentController,
    currentSessionId: () => args.currentSessionId ?? SESSION.id,
    sessions: {
      persistMessages: vi.fn(async () => {}),
      settleInterruptedConfirmation,
      updateFields,
      removeSteers,
    },
    transitionSessionJob:
      transitionMock as unknown as AgentController['transition'],
    clearLiveActivities: vi.fn(),
    clearLiveProcess: vi.fn(),
    clearRunTasks: vi.fn(),
    setMessageReveal: vi.fn(),
    setMessages: vi.fn(),
    applySessionSnapshot: vi.fn(),
    setStatusFor: vi.fn(),
    idleStatus: IDLE_STATUS,
    deleteAbortController: vi.fn(),
    turnToolNames: () => args.toolNames ?? ['runNode'],
    deliveredSteerIds: () => args.deliveredSteers ?? [],
    clearDeliveredSteers: vi.fn(),
    activeQueuedTurnId: () => args.activeQueuedTurnId,
    prefersReducedMotion: () => false,
    now: () => 1234,
  }
  return {
    input,
    controller,
    setCurrentController: (next: AbortController | undefined) => {
      currentController = next as AbortController
    },
    settleInterruptedConfirmation,
    removeSteers,
    updateFields,
    transitionSessionJob: transitionMock,
    setMessageReveal: input.setMessageReveal as ReturnType<typeof vi.fn>,
    setMessages: input.setMessages as ReturnType<typeof vi.fn>,
    applySessionSnapshot:
      input.applySessionSnapshot as ReturnType<typeof vi.fn>,
    setStatusFor: input.setStatusFor as ReturnType<typeof vi.fn>,
    persistMessages:
      input.sessions.persistMessages as ReturnType<typeof vi.fn>,
    deleteAbortController:
      input.deleteAbortController as ReturnType<typeof vi.fn>,
    clearDeliveredSteers:
      input.clearDeliveredSteers as ReturnType<typeof vi.fn>,
  }
}

describe('coordinateAgentOutcome', () => {
  it('★★ controller 已被新回合替换时，旧 outcome 不得写消息或 Job', async () => {
    const outcome: AgentLoopOutcome = {
      kind: 'message',
      text: '旧回合迟到',
      messages: [{ role: 'assistant', content: '旧回合迟到' }],
    }
    const oldController = new AbortController()
    const h = harness({
      outcome,
      controller: oldController,
      currentController: () => new AbortController(),
    })

    const result = await coordinateAgentOutcome(h.input)

    expect(result).toBe('ignored')
    expect(h.persistMessages).not.toHaveBeenCalled()
    expect(h.updateFields).not.toHaveBeenCalled()
    expect(h.transitionSessionJob).not.toHaveBeenCalled()
    expect(h.setStatusFor).not.toHaveBeenCalled()
  })

  it('★★ controller 已被删除时，旧 confirm 仍原子补中断且不覆盖当前历史', async () => {
    const outcome: AgentLoopOutcome = {
      kind: 'confirm',
      request: {
        callId: 'call-old',
        name: 'runNode',
        args: { nodeIds: ['node-old'] },
      },
      messages: [{ role: 'assistant', content: '旧确认' }],
    }
    const h = harness({
      outcome,
      currentController: () => undefined,
    })

    const result = await coordinateAgentOutcome(h.input)

    expect(result).toBe('stale_settled')
    expect(h.settleInterruptedConfirmation).toHaveBeenCalledWith(
      SESSION.id,
      outcome.request,
    )
    expect(h.persistMessages).not.toHaveBeenCalled()
    expect(h.updateFields).not.toHaveBeenCalled()
    expect(h.transitionSessionJob).not.toHaveBeenCalled()
  })

  it('★★ 当前 confirm 持久化 pending、工具白名单、Job 与状态', async () => {
    const outcome: AgentLoopOutcome = {
      kind: 'confirm',
      request: {
        callId: 'call-confirm',
        name: 'runNode',
        args: { nodeIds: ['node-1'] },
      },
      messages: [{ role: 'user', content: '运行这张图' }],
    }
    const h = harness({ outcome })

    const result = await coordinateAgentOutcome(h.input)

    expect(result).toBe('applied')
    expect(h.updateFields).toHaveBeenCalledWith(SESSION.id, {
      pendingConfirmation: {
        callId: 'call-confirm',
        name: 'runNode',
        args: { nodeIds: ['node-1'] },
      },
      continuation: undefined,
      allowedToolNames: ['runNode'],
    })
    expect(h.transitionSessionJob).toHaveBeenCalledWith(
      SESSION.id,
      'waiting_confirmation',
      'confirmation_requested',
      { pendingCallId: 'call-confirm' },
      { tool: 'runNode' },
    )
    expect(h.setStatusFor).toHaveBeenCalledWith(SESSION.id, {
      kind: 'awaitingConfirm',
      request: outcome.request,
    })
    expect(h.deleteAbortController).not.toHaveBeenCalled()
  })

  it('★★ message 收口 completed / idle，并按 controller 删除 abort', async () => {
    const outcome: AgentLoopOutcome = {
      kind: 'message',
      text: '已完成',
      messages: [{ role: 'assistant', content: '已完成' }],
    }
    const h = harness({
      outcome,
      deliveredSteers: ['steer-1'],
    })

    const result = await coordinateAgentOutcome(h.input)

    expect(result).toBe('applied')
    expect(h.transitionSessionJob).toHaveBeenCalledWith(
      SESSION.id,
      'completed',
      'completed',
    )
    expect(h.setStatusFor).toHaveBeenCalledWith(SESSION.id, IDLE_STATUS)
    expect(h.deleteAbortController).toHaveBeenCalledWith(
      SESSION.id,
      h.controller,
    )
    expect(h.removeSteers).toHaveBeenCalledWith(SESSION.id, ['steer-1'])
    expect(h.clearDeliveredSteers).toHaveBeenCalledTimes(1)
  })

  it('★★ 同一 controller 已 abort 的迟到 confirm 补 interrupted 并清持久卡，不写 UI/Job 成功', async () => {
    const outcome: AgentLoopOutcome = {
      kind: 'confirm',
      request: {
        callId: 'call-stale',
        name: 'deleteNodes',
        args: { nodeIds: ['node-1'] },
      },
      messages: [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-stale',
              name: 'deleteNodes',
              args: '{"nodeIds":["node-1"]}',
            },
          ],
        },
      ],
    }
    const controller = new AbortController()
    controller.abort()
    const h = harness({ outcome, controller })

    const result = await coordinateAgentOutcome(h.input)

    expect(result).toBe('stale_settled')
    expect(h.settleInterruptedConfirmation).toHaveBeenCalledWith(
      SESSION.id,
      outcome.request,
    )
    expect(h.persistMessages).not.toHaveBeenCalled()
    expect(h.updateFields).not.toHaveBeenCalled()
    expect(h.transitionSessionJob).not.toHaveBeenCalled()
    expect(h.setMessages).not.toHaveBeenCalled()
    expect(h.setStatusFor).not.toHaveBeenCalled()
    expect(h.applySessionSnapshot).not.toHaveBeenCalled()
    expect(h.deleteAbortController).not.toHaveBeenCalled()
  })

  it('★★ 非当前界面会话只落库，不覆盖当前 B 的消息与 reveal', async () => {
    const outcome: AgentLoopOutcome = {
      kind: 'message',
      text: '后台会话完成',
      messages: [{ role: 'assistant', content: '后台会话完成' }],
    }
    const h = harness({
      outcome,
      currentSessionId: 'session-b',
    })

    const result = await coordinateAgentOutcome(h.input)

    expect(result).toBe('applied')
    expect(h.input.sessions.persistMessages).toHaveBeenCalledTimes(1)
    expect(h.setMessages).not.toHaveBeenCalled()
    expect(h.setMessageReveal).not.toHaveBeenCalled()
    expect(h.applySessionSnapshot).toHaveBeenCalledTimes(1)
  })

  it('★★ paused checkpoint 保留 abort，并持久 continuation / 工具白名单', async () => {
    const outcome: AgentLoopOutcome = {
      kind: 'stopped',
      reason: '检查点',
      messages: [{ role: 'assistant', content: '暂停一下' }],
      checkpoint: {
        kind: 'max_steps',
        maxSteps: 8,
        completedSteps: 8,
      },
    }
    const h = harness({
      outcome,
      activeQueuedTurnId: 'queued-1',
      toolNames: ['readGraph', 'runNode'],
    })

    const result = await coordinateAgentOutcome(h.input)

    expect(result).toBe('applied')
    expect(h.updateFields).toHaveBeenCalledWith(SESSION.id, {
      pendingConfirmation: undefined,
      continuation: {
        reason: 'max_steps',
        maxSteps: 8,
        createdAt: 1234,
        queuedTurnId: 'queued-1',
      },
      allowedToolNames: ['readGraph', 'runNode'],
    })
    expect(h.transitionSessionJob).toHaveBeenCalledWith(
      SESSION.id,
      'paused',
      'checkpoint_saved',
      {
        checkpoint: {
          kind: 'max_steps',
          maxSteps: 8,
          completedSteps: 8,
          savedAt: 1234,
        },
      },
    )
    expect(h.setStatusFor).toHaveBeenCalledWith(SESSION.id, {
      kind: 'paused',
      message: '已完成 8 步，可继续',
    })
    expect(h.deleteAbortController).not.toHaveBeenCalled()
  })
})
