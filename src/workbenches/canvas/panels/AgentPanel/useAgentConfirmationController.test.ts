import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'
import type { AgentPanelStatus } from './AgentActivityViews'
import { interruptOriginFor } from './agentInterruptOrigin'
import type { AgentConfirmationRunInput } from './agentConfirmationRun'
import {
  useAgentConfirmationController,
  type AgentConfirmationController,
  type AgentConfirmationControllerInput,
} from './useAgentConfirmationController'

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

const request: AgentToolRequest = {
  callId: 'call-1',
  name: 'node.delete',
  args: {},
}

const awaiting: AgentPanelStatus = { kind: 'awaitingConfirm', request }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Harness {
  input: AgentConfirmationControllerInput
  confirming: Set<string>
  inFlight: Map<string, AgentToolRequest>
  events: string[]
}

function harness(
  patch: Partial<AgentConfirmationControllerInput> = {},
): Harness {
  const events: string[] = []
  const confirming = new Set<string>()
  const inFlight = new Map<string, AgentToolRequest>()
  const input: AgentConfirmationControllerInput = {
    current: session(),
    status: awaiting,
    messages: [{ role: 'user', content: '删掉这个' }],
    confirmingRef: { current: confirming },
    inFlightConfirmationRef: { current: inFlight },
    currentTurnJobIdRef: { current: new Map([['s1', 'job-1']]) },
    currentTurnIdRef: { current: new Map([['s1', 'turn-1']]) },
    currentTurnRevisionRef: { current: new Map([['s1', 7]]) },
    activeQueueTurnOf: vi.fn(() => undefined),
    controller: {
      jobId: vi.fn(() => 'job-ctl'),
      turnId: vi.fn(() => 'turn-ctl'),
      beginConfirmation: vi.fn(async () => {}),
      finishConfirmedTool: vi.fn(async () => {}),
    },
    runConfirmation: vi.fn(async (params) => {
      events.push(`run:${params.request.callId}`)
      return 'done'
    }),
    executeConfirmedTool: vi.fn(async () => ({})),
    ensureRoute: vi.fn(async () => ({
      ok: true as const,
      route: {} as never,
    })),
    loopDeps: vi.fn(() => ({}) as never),
    toolModeRef: { current: new Map([['s1', 'native']]) },
    turnToolsForSession: vi.fn(() => []),
    resumeAgentTurn: vi.fn() as unknown as AgentConfirmationRunInput['resumeAgentTurn'],
    continueAutoConfirmations: vi.fn() as unknown as AgentConfirmationRunInput['continueAutoConfirmations'],
    handleOutcome: vi.fn() as unknown as AgentConfirmationRunInput['handleOutcome'],
    settleSessionOutcome: vi.fn(async () => {}),
    transitionSessionJob: vi.fn() as unknown as AgentConfirmationRunInput['transitionSessionJob'],
    abortRefs: { current: new Map() },
    currentIdRef: { current: 's1' },
    setStatusFor: vi.fn(),
    setMessages: vi.fn(),
    settleInterruptedSession: vi.fn(async () => ({
      session: null,
      cleanupError: undefined,
    })),
    trackRun: (work) => work(),
    notify: vi.fn(),
    ...patch,
  }
  return { input, confirming, inFlight, events }
}

function render(props: AgentConfirmationControllerInput): {
  viewRef: { current: AgentConfirmationController | null }
} {
  const viewRef: { current: AgentConfirmationController | null } = {
    current: null,
  }
  function Probe(next: AgentConfirmationControllerInput) {
    viewRef.current = useAgentConfirmationController(next)
    return null
  }
  act(() => {
    TestRenderer.create(createElement(Probe, props))
  })
  return { viewRef }
}

describe('confirm / 守卫与锁', () => {
  it('不是确认卡状态 / 没有当前会话 → 什么都不做', async () => {
    const thinking = harness({ status: { kind: 'thinking' } })
    const noCurrent = harness({ current: null })

    await render(thinking.input).viewRef.current!.confirm()
    await render(noCurrent.input).viewRef.current!.confirm()

    expect(thinking.input.runConfirmation).not.toHaveBeenCalled()
    expect(thinking.confirming.size).toBe(0)
    expect(noCurrent.input.runConfirmation).not.toHaveBeenCalled()
  })

  it('同一 tick 连点只进一次，第二次立刻返回', async () => {
    const gate = deferred<unknown>()
    const h = harness({
      runConfirmation: vi.fn(() => gate.promise) as never,
    })
    const { viewRef } = render(h.input)

    let first!: Promise<void>
    act(() => {
      first = viewRef.current!.confirm()
    })
    expect(h.confirming.has('s1')).toBe(true)

    await expect(viewRef.current!.confirm()).resolves.toBeUndefined()
    expect(h.input.runConfirmation).toHaveBeenCalledTimes(1)

    gate.resolve('done')
    await act(async () => {
      await first
    })
    expect(h.confirming.has('s1')).toBe(false)
  })

  it('成功与失败都释放 confirming；inFlight 只在 callId 相同时清', async () => {
    const ok = harness()
    await render(ok.input).viewRef.current!.confirm()
    expect(ok.confirming.has('s1')).toBe(false)
    expect(ok.inFlight.has('s1')).toBe(false)

    const failing = harness({
      runConfirmation: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    await expect(
      render(failing.input).viewRef.current!.confirm(),
    ).rejects.toThrow('boom')
    expect(failing.confirming.has('s1')).toBe(false)
    expect(failing.inFlight.has('s1')).toBe(false)
  })

  it('inFlight 已被换成另一次确认时不误删（callId 守卫）', async () => {
    const other: AgentToolRequest = { ...request, callId: 'call-2' }
    const h = harness({
      runConfirmation: vi.fn(async () => {
        h.inFlight.set('s1', other)
        return 'done'
      }) as never,
    })

    await render(h.input).viewRef.current!.confirm()

    expect(h.inFlight.get('s1')).toBe(other)
    expect(h.confirming.has('s1')).toBe(false)
  })
})

describe('confirm / 快照与 origin', () => {
  it('把点击瞬间的 session / request / messages 交给 runAgentConfirmation', async () => {
    const h = harness()
    const target = h.input.current

    await render(h.input).viewRef.current!.confirm()

    const params = (h.input.runConfirmation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentConfirmationRunInput
    expect(params.session).toBe(target)
    expect(params.request).toEqual(request)
    expect(params.messages).toBe(h.input.messages)
    expect(params.ensureRoute).toBe(h.input.ensureRoute)
  })

  it('turnOrigin 与本回合 stop / 引导同一套口径（queueTurnId 优先）', async () => {
    const h = harness({
      activeQueueTurnOf: vi.fn(() => 'queue-9'),
    })

    await render(h.input).viewRef.current!.confirm()

    const params = (h.input.runConfirmation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentConfirmationRunInput
    const origin = params.turnOrigin()
    expect(origin).toEqual(
      interruptOriginFor({
        session: h.input.current!,
        refs: {
          currentTurnJobId: h.input.currentTurnJobIdRef,
          currentTurnId: h.input.currentTurnIdRef,
          currentTurnRevision: h.input.currentTurnRevisionRef,
        },
        controller: h.input.controller,
        activeQueueTurnOf: h.input.activeQueueTurnOf,
      }),
    )
    expect(origin).toEqual({
      jobId: 'job-1',
      turnId: 'queue-9',
      queueTurnId: 'queue-9',
      messageRevision: 7,
    })
  })

  it('toolMode / turnTools 是调用时现取，不是建卡时的值', async () => {
    const h = harness()

    await render(h.input).viewRef.current!.confirm()

    const params = (h.input.runConfirmation as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as AgentConfirmationRunInput
    h.input.toolModeRef.current.set('s1', 'json')
    expect(params.toolMode()).toBe('json')
    params.turnTools()
    expect(h.input.turnToolsForSession).toHaveBeenCalledWith(
      h.input.current,
    )
  })
})

describe('cancel / 与 stop 的区别（保留可恢复 Job）', () => {
  it('用 canceled 结算，且只在没有 cleanupError 时提示"已取消"', async () => {
    const clean = harness()
    await render(clean.input).viewRef.current!.cancel()
    expect(clean.input.settleInterruptedSession).toHaveBeenCalledWith(
      clean.input.current,
      request,
      'canceled',
    )
    expect(clean.input.notify).toHaveBeenCalledWith(
      '已取消；本次没有执行工具，也不会自动新增节点',
      'info',
    )

    const dirty = harness({
      settleInterruptedSession: vi.fn(async () => ({
        session: null,
        cleanupError: new Error('cleanup failed'),
      })),
    })
    await render(dirty.input).viewRef.current!.cancel()
    expect(dirty.input.notify).not.toHaveBeenCalled()
  })

  it('确认进行中（confirming 已占）时 cancel 不插队', async () => {
    const h = harness()
    h.confirming.add('s1')

    await render(h.input).viewRef.current!.cancel()

    expect(h.input.settleInterruptedSession).not.toHaveBeenCalled()
    expect(h.confirming.has('s1')).toBe(true)
  })

  it('cancel 结束会释放 confirming', async () => {
    const h = harness()

    await render(h.input).viewRef.current!.cancel()

    expect(h.confirming.has('s1')).toBe(false)
  })
})
