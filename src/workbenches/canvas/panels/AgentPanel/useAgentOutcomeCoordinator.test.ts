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
  persist: AgentOutcomeCoordinatorHookInput['persist']
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
        settleInterruptedConfirmation:
          input.settleInterruptedConfirmation,
        updateFields: vi.fn(async () => null),
        removeSteers: vi.fn(async () => null),
      } as unknown as AgentController['sessions'],
      persist: input.persist,
      transitionSessionJob: input.transition as AgentController['transition'],
      clearLiveActivitiesFor: vi.fn(),
      clearLiveProcessFor: vi.fn(),
      clearRunTasksFor: vi.fn(),
      setMessageReveal: vi.fn(),
      setMessages: input.setMessages,
      applySessionSnapshot: vi.fn(),
      setStatusFor: input.setStatusFor,
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
    const persist = vi.fn(async () => {})
    const transition = vi.fn(async () => null)
    const setMessages = vi.fn()
    const setStatusFor = vi.fn()
    const settleInterruptedConfirmation = vi.fn(
      async () => null,
    )
    const handle = captureHook({
      abortRefs: new Map([[session.id, newController]]),
      persist,
      transition,
      setMessages,
      setStatusFor,
      settleInterruptedConfirmation,
    })

    await handle(
      session,
      {
        kind: 'message',
        text: '旧回合',
        messages: [{ role: 'assistant', content: '旧回合' }],
      },
      undefined,
      oldController,
    )

    expect(persist).not.toHaveBeenCalled()
    expect(transition).not.toHaveBeenCalled()
    expect(setMessages).not.toHaveBeenCalled()
    expect(setStatusFor).not.toHaveBeenCalled()
  })

  it('当前 controller 身份一致时正常收口', async () => {
    const controller = new AbortController()
    const persist = vi.fn(async () => {})
    const transition = vi.fn(async () => null)
    const setMessages = vi.fn()
    const setStatusFor = vi.fn()
    const settleInterruptedConfirmation = vi.fn(
      async () => null,
    )
    const handle = captureHook({
      abortRefs: new Map([[session.id, controller]]),
      persist,
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

    expect(persist).toHaveBeenCalledTimes(1)
    expect(transition).toHaveBeenCalledWith(
      session.id,
      'completed',
      'completed',
    )
    expect(setMessages).toHaveBeenCalledTimes(1)
    expect(setStatusFor).toHaveBeenCalledWith(session.id, { kind: 'idle' })
  })
})
