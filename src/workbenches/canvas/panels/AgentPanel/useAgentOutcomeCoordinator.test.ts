import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  useAgentOutcomeCoordinator,
  type AgentOutcomeCoordinatorHookInput,
} from './useAgentOutcomeCoordinator'

const session: AgentSession = {
  id: 'session-hook-outcome',
  projectId: 'project-1',
  title: '结果 hook',
  channelId: '',
  model: 'chat-model',
  queuedTurns: [],
  pendingSteers: [],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function captureHook(input: {
  abortRefs: Map<string, AbortController>
  applyOutcome: AgentController['sessions']['applyAgentOutcome']
  transition: AgentOutcomeCoordinatorHookInput['transitionSessionJob']
  setMessages: AgentOutcomeCoordinatorHookInput['setMessages']
  setStatusFor: AgentOutcomeCoordinatorHookInput['setStatusFor']
  settleInterruptedConfirmation:
    AgentController['sessions']['settleInterruptedConfirmation']
}) {
  type OutcomeHandle = ReturnType<
    typeof useAgentOutcomeCoordinator
  >
  const handles: OutcomeHandle[] = []

  function Probe() {
    handles.push(useAgentOutcomeCoordinator({
      currentIdRef: { current: session.id },
      abortRefs: { current: input.abortRefs },
      deliveredSteersRef: { current: new Map() },
      turnToolsRef: { current: new Map() },
      sessions: {
        applyAgentOutcome: input.applyOutcome,
        settleInterruptedConfirmation:
          input.settleInterruptedConfirmation,
      } as unknown as AgentController['sessions'],
      refresh: vi.fn(async () => []),
      transitionSessionJob: input.transition as AgentController['transition'],
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setMessageReveal: vi.fn(),
      setMessages: input.setMessages,
      applySessionSnapshot: vi.fn(),
      setStatusFor: input.setStatusFor,
      turnOriginFor: () => ({}),
    }))
    return createElement('span', null, 'ok')
  }

  renderToStaticMarkup(createElement(Probe))
  const handle = handles[0]
  if (!handle) throw new Error('handleOutcome not captured')
  return handle
}

describe('useAgentOutcomeCoordinator', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('★★ 使用回合创建时的 controller，拒绝被新 controller 替换后的旧 outcome', async () => {
    const oldController = new AbortController()
    const newController = new AbortController()
    const applyOutcome = vi.fn(async () => ({
      ok: true as const,
      session,
    }))
    const transition = vi.fn(async () => null)
    const setMessages = vi.fn()
    const setStatusFor = vi.fn()
    const settleInterruptedConfirmation = vi.fn(
      async () => null,
    )
    const handle = captureHook({
      abortRefs: new Map([[session.id, newController]]),
      applyOutcome,
      transition,
      setMessages,
      setStatusFor,
      settleInterruptedConfirmation,
    })

    /**
     * #927：光断言"都没被调用"是假绿 —— 钩子整个抛错、或提前 return 都会满足。
     * 断言返回值是 `ignored`，才证明它真的走到了"controller 已换人"那条分支。
     */
    await expect(
      handle(
        session,
        {
          kind: 'message',
          text: '旧回合',
          messages: [{ role: 'assistant', content: '旧回合' }],
        },
        undefined,
        oldController,
      ),
    ).resolves.toBe('ignored')

    expect(applyOutcome).not.toHaveBeenCalled()
    expect(transition).not.toHaveBeenCalled()
    expect(setMessages).not.toHaveBeenCalled()
    expect(setStatusFor).not.toHaveBeenCalled()
  })

  it('当前 controller 身份一致时正常收口', async () => {
    const controller = new AbortController()
    const applyOutcome = vi.fn(async () => ({
      ok: true as const,
      session,
    }))
    const transition = vi.fn(async () => null)
    const setMessages = vi.fn()
    const setStatusFor = vi.fn()
    const settleInterruptedConfirmation = vi.fn(
      async () => null,
    )
    const handle = captureHook({
      abortRefs: new Map([[session.id, controller]]),
      applyOutcome,
      transition,
      setMessages,
      setStatusFor,
      settleInterruptedConfirmation,
    })

    await handle(
      session,
      {
        kind: 'message',
        text: '当前回合',
        messages: [{ role: 'assistant', content: '当前回合' }],
      },
      undefined,
      controller,
    )

    expect(applyOutcome).toHaveBeenCalledTimes(1)
    expect(transition).toHaveBeenCalledWith(
      session.id,
      'completed',
      'completed',
      undefined,
      undefined,
      {},
    )
    expect(setMessages).toHaveBeenCalledTimes(1)
    expect(setStatusFor).toHaveBeenCalledWith(session.id, { kind: 'idle' })
  })
})
