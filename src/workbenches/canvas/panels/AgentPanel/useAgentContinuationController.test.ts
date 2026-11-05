import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { AgentLoopDeps } from '../../agent/agentLoop'
import type { AgentPanelStatus } from './AgentActivityViews'
import type { AgentContinuationRunInput } from './agentContinuationRun'
import {
  useAgentContinuationController,
  type AgentContinueTask,
  type AgentContinuationControllerInput,
} from './useAgentContinuationController'

function session(id = 's1'): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    messageRevision: 11,
    createdAt: 1,
    updatedAt: 1,
  }
}

const paused: AgentPanelStatus = {
  kind: 'paused',
  message: '本轮暂停',
}

function harness(
  patch: Partial<AgentContinuationControllerInput> = {},
): {
  input: AgentContinuationControllerInput
  abortRefs: Map<string, AbortController>
} {
  const abortRefs = new Map<string, AbortController>()
  const input: AgentContinuationControllerInput = {
    current: session(),
    status: paused,
    messages: [{ role: 'user', content: '继续' }],
    sessions: {
      messagesFor: vi.fn(async (): Promise<ChatMessage[]> => [{ role: 'user', content: '继续' }]),
    },
    sessionBrief: vi.fn(() => undefined),
    localRevision: 11,
    sessionRevision: 11,
    controller: {
      jobId: vi.fn(() => 'job-ctl'),
      turnId: vi.fn(() => 'turn-ctl'),
      claimNextQueuedTurn: vi.fn(async () => null),
    },
    activeQueueTurnOf: vi.fn(() => undefined),
    currentTurnJobIdRef: { current: new Map([['s1', 'job-ref']]) },
    currentTurnIdRef: { current: new Map([['s1', 'turn-ref']]) },
    currentTurnRevisionRef: { current: new Map([['s1', 3]]) },
    isActivityActive: vi.fn(() => false),
    claimActivity: vi.fn(() => true),
    applySessionSnapshot: vi.fn(),
    ensureRoute: vi.fn(async () => ({}) as never),
    loopDeps: vi.fn(() => ({}) as AgentLoopDeps),
    toolModeRef: { current: new Map([['s1', 'native']]) },
    turnToolsForSession: vi.fn(() => []),
    transitionSessionJob: vi.fn() as unknown as AgentContinuationRunInput['transitionSessionJob'],
    abortRefs: { current: abortRefs },
    setStatusFor: vi.fn(),
    runAgentTurn: vi.fn() as unknown as AgentContinuationRunInput['runAgentTurn'],
    continueAutoConfirmations: vi.fn() as unknown as AgentContinuationRunInput['continueAutoConfirmations'],
    handleOutcome: vi.fn() as unknown as AgentContinuationRunInput['handleOutcome'],
    settleSessionOutcome: vi.fn(async () => {}),
    currentIdRef: { current: 's1' },
    setMessages: vi.fn(),
    trackRun: (work) => work(),
    runContinuation: vi.fn(async () => 'done'),
    ...patch,
  }
  return { input, abortRefs }
}

function render(props: AgentContinuationControllerInput): {
  viewRef: { current: AgentContinueTask | null }
} {
  const viewRef: { current: AgentContinueTask | null } = { current: null }
  function Probe(next: AgentContinuationControllerInput) {
    viewRef.current = useAgentContinuationController(next)
    return null
  }
  act(() => {
    TestRenderer.create(createElement(Probe, props))
  })
  return { viewRef }
}

describe('continueTask / 守卫', () => {
  it('不是 paused / 没有当前会话 → 不进续跑', async () => {
    const thinking = harness({ status: { kind: 'thinking' } })
    const noCurrent = harness({ current: null })

    await render(thinking.input).viewRef.current!()
    await render(noCurrent.input).viewRef.current!()

    expect(thinking.input.runContinuation).not.toHaveBeenCalled()
    expect(noCurrent.input.runContinuation).not.toHaveBeenCalled()
  })

  it('故意不加锁：连续两次调用都会进续跑（防重在模块的 claim）', async () => {
    const h = harness()
    const { viewRef } = render(h.input)

    await viewRef.current!()
    await viewRef.current!()

    expect(h.input.runContinuation).toHaveBeenCalledTimes(2)
  })
})

describe('continueTask / 端口语义', () => {
  it('session / messages / claimActivity 原样交给续跑', async () => {
    const h = harness()

    await render(h.input).viewRef.current!()

    const params = (h.input.runContinuation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentContinuationRunInput
    expect(params.session).toBe(h.input.current)
    expect(params.messages).toBe(h.input.messages)
    // 必须是模块函数本身：多包一层会改变 claim 的原子性
    expect(params.claimActivity).toBe(h.input.claimActivity)
    expect(params.claimNextQueuedTurn).toBe(
      h.input.controller.claimNextQueuedTurn,
    )
  })

  it('把目标会话的 messagesFor 与 per-session revision 交给续跑，不接界面当前会话', async () => {
    const h = harness({
      current: session('s1'),
      currentIdRef: { current: 's2' },
      sessions: {
        messagesFor: vi.fn(async (): Promise<ChatMessage[]> => [
          { role: 'user', content: 's1 历史' },
        ]),
      },
    })
    await render(h.input).viewRef.current!()
    const params = (h.input.runContinuation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentContinuationRunInput
    expect(params.sessions?.messagesFor).toBe(h.input.sessions?.messagesFor)
    expect(params.sessionRevision).toBe(11)
    expect(params.localRevision).toBe(11)
    expect(params.messages).toBe(h.input.messages)
  })

  it('turnOrigin(turnId, queueTurnId)：参数优先、job/revision 现读 ref', async () => {
    const h = harness()

    await render(h.input).viewRef.current!()

    const params = (h.input.runContinuation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentContinuationRunInput
    expect(params.turnOrigin('turn-arg', 'queue-arg')).toEqual({
      jobId: 'job-ref',
      turnId: 'turn-arg',
      queueTurnId: 'queue-arg',
      messageRevision: 11,
    })
    // 没有 turnId 参数时退回 controller
    expect(params.turnOrigin(undefined as never, undefined).turnId).toBe(
      'turn-ctl',
    )
  })

  it('activeQueueTurnId / currentTurnId / toolMode 都是调用时现取', async () => {
    const h = harness()

    await render(h.input).viewRef.current!()
    const params = (h.input.runContinuation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentContinuationRunInput

    h.input.toolModeRef.current.set('s1', 'json')
    ;(h.input.activeQueueTurnOf as ReturnType<typeof vi.fn>).mockReturnValue(
      'queue-9',
    )
    h.input.currentTurnIdRef.current.set('s1', 'turn-latest')

    expect(params.toolMode()).toBe('json')
    expect(params.activeQueueTurnId()).toBe('queue-9')
    expect(params.currentTurnId()).toBe('turn-latest')
  })

  it('setAbortController 写进 abortRefs，turnTools 用目标会话取', async () => {
    const h = harness()

    await render(h.input).viewRef.current!()
    const params = (h.input.runContinuation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentContinuationRunInput
    const abort = new AbortController()
    params.setAbortController(abort)
    params.turnTools()

    expect(h.abortRefs.get('s1')).toBe(abort)
    expect(h.input.turnToolsForSession).toHaveBeenCalledWith(
      h.input.current,
    )
  })
})
