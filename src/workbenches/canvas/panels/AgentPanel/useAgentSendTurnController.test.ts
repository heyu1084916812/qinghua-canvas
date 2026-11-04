import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopDeps, AgentLoopOutcome } from '../../agent/agentLoop'
import type { AgentTurnRequestPreparation } from './agentTurnRequest'
import type { AgentPrepareArgs } from './agentSendTurnRun'
import {
  useAgentSendTurnController,
  type AgentRunSendText,
  type AgentSendTurnControllerInput,
} from './useAgentSendTurnController'

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
    createdAt: 1,
    updatedAt: 1,
  }
}

const DEPS = {} as AgentLoopDeps
const OUTCOME: AgentLoopOutcome = {
  kind: 'message',
  text: 'ok',
  messages: [{ role: 'assistant', content: 'ok' }],
}

const persisted = {
  modelWindow: [],
  userMessage: { role: 'user' as const, content: 'hi' },
  historyMessages: [{ role: 'user' as const, content: 'hi' }],
  outcomeTailIndex: 0,
  saved: session('s1'),
  messageRevision: 3,
}

function input(
  overrides: Partial<AgentSendTurnControllerInput> = {},
): AgentSendTurnControllerInput {
  const sessionRuntime = {
    current: { setPerImage: vi.fn() },
  }
  return {
    currentTurnJobIdRef: { current: new Map<string, string>() },
    currentTurnIdRef: { current: new Map<string, string>() },
    currentTurnRevisionRef: { current: new Map<string, number>() },
    abortRefs: { current: new Map<string, AbortController>() },
    contextTraceRef: { current: new Map() },
    toolModeRef: { current: new Map() },
    explicitMediaModelsRef: { current: new Map() },
    turnToolsRef: { current: new Map() },
    currentIdRef: { current: 's1' },
    sessionRuntime,
    setList: vi.fn(),
    setCurrent: vi.fn(),
    setDraft: vi.fn(),
    writeDraftForSession: vi.fn(),
    setMessages: vi.fn(),
    setStatusFor: vi.fn(),
    clearLiveActivitiesFor: vi.fn(),
    clearLiveProcessFor: vi.fn(),
    clearRunTasksFor: vi.fn(),
    clearReveal: vi.fn(),
    trackRun: (work) => work(),
    updateSessionFields: vi.fn(async () => null),
    failTurn: vi.fn(async () => {}),
    ensureJob: vi.fn(async () => ({ id: 'job-1' })),
    transitionSessionJob: vi.fn(async () => null),
    loopDeps: vi.fn(() => DEPS),
    runAgentTurn: vi.fn(async () => OUTCOME),
    continueAutoConfirmations: vi.fn(async (_session, initial) => initial),
    handleOutcome: vi.fn(async () => {}),
    bindTurnToSessionActivity: vi.fn(() => true),
    syncAutoRunFromSession: vi.fn(),
    prepareTurn: vi.fn(
      async (): Promise<AgentTurnRequestPreparation> => ({
        kind: 'aborted_before_job',
        persistedTurn: persisted,
      }),
    ),
    ...overrides,
  }
}

function render(props: AgentSendTurnControllerInput): {
  viewRef: { current: AgentRunSendText | null }
  update: (next: AgentSendTurnControllerInput) => void
} {
  const viewRef: { current: AgentRunSendText | null } = { current: null }
  function Probe(next: AgentSendTurnControllerInput) {
    viewRef.current = useAgentSendTurnController(next)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe, props))
  })
  return {
    viewRef,
    update: (next) => {
      act(() => renderer.update(createElement(Probe, next)))
    },
  }
}

describe('useAgentSendTurnController / 端口装配', () => {
  it('把 session / text / internalControl / signal 与两个顺序回调交给 prepareTurn', async () => {
    const props = input()
    const { viewRef } = render(props)
    const target = session('s1')

    const outcome = await (async () => {
      let result: Awaited<ReturnType<AgentRunSendText>> | null = null
      await act(async () => {
        result = await viewRef.current!('画一张海报', target)
      })
      return result
    })()

    expect(outcome).toBeUndefined()
    const args = (props.prepareTurn as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentPrepareArgs
    expect(args.session).toBe(target)
    expect(args.text).toBe('画一张海报')
    expect(args.internalControl).toBe(false)
    expect(args.signal).toBeInstanceOf(AbortSignal)
    expect(typeof args.hooks.onPersisted).toBe('function')
    expect(typeof args.hooks.onRouteReady).toBe('function')
    expect(props.runAgentTurn).not.toHaveBeenCalled()
  })

  it('happy path：refs 与 UI 端口都真的接到主体上', async () => {
    const props = input({
      prepareTurn: vi.fn<(_: AgentPrepareArgs) => Promise<AgentTurnRequestPreparation>>(
        async ({ hooks }) => {
          hooks.onPersisted(persisted)
          await hooks.onRouteReady('op-1')
          return {
            kind: 'ready',
            operationId: 'op-1',
            persistedTurn: persisted,
            visualNodeIds: [],
            contextTrace: null,
            explicitMediaModels: {},
            perImage: true,
            toolMode: 'native',
            turnTools: [],
            systemPrompt: 'SYSTEM',
          } as unknown as AgentTurnRequestPreparation
        },
      ),
    })
    const { viewRef } = render(props)

    let outcome: Awaited<ReturnType<AgentRunSendText>> | null = null
    await act(async () => {
      outcome = await viewRef.current!('画一张海报', session('s1'))
    })

    expect(outcome).toBe(OUTCOME)
    // refs 接线
    expect(props.currentTurnIdRef.current.get('s1')).toBeDefined()
    expect(props.currentTurnRevisionRef.current.get('s1')).toBe(3)
    expect(props.currentTurnJobIdRef.current.get('s1')).toBe('job-1')
    expect(props.toolModeRef.current.get('s1')).toBe('native')
    // UI 接线
    expect(props.setStatusFor).toHaveBeenCalledWith('s1', {
      kind: 'thinking',
    })
    expect(props.sessionRuntime.current.setPerImage).toHaveBeenCalledWith(
      's1',
      true,
    )
    // 收口顺序：run → continue → handleOutcome 都发生过
    expect(props.runAgentTurn).toHaveBeenCalledTimes(1)
    expect(props.continueAutoConfirmations).toHaveBeenCalledTimes(1)
    expect(props.handleOutcome).toHaveBeenCalledTimes(1)
  })

  it('端口不变时返回的回调身份不变', () => {
    const props = input()
    const { viewRef, update } = render(props)
    const first = viewRef.current

    update({ ...props })

    expect(viewRef.current).toBe(first)
  })
})
