import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'
import type { AgentTurnRefMaps } from './agentInterruptOrigin'
import {
  useAgentInterruptSettlementController,
  type AgentInterruptSettlement,
  type AgentInterruptSettlementControllerInput,
} from './useAgentInterruptSettlementController'

function session(
  id = 's1',
  patch: Partial<AgentSession> = {},
): AgentSession {
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
    ...patch,
  }
}

const request: AgentToolRequest = {
  callId: 'call-1',
  name: 'node.delete',
  args: {},
}

interface Harness {
  input: AgentInterruptSettlementControllerInput
  events: string[]
  refs: AgentTurnRefMaps
}

function harness(
  patch: Partial<AgentInterruptSettlementControllerInput> = {},
  options: { session?: AgentSession; settled?: AgentSession | null } = {},
): Harness {
  const events: string[] = []
  const target = options.session ?? session('s1', { messageRevision: 5 })
  const refs: AgentTurnRefMaps = {
    abort: { current: new Map<string, AbortController>() },
    deliveredSteers: { current: new Map<string, Set<string>>() },
    inFlightConfirmation: {
      current: new Map<string, AgentToolRequest>(),
    },
    currentTurnId: { current: new Map<string, string>() },
    currentTurnJobId: { current: new Map<string, string>() },
    currentTurnRevision: { current: new Map<string, number>() },
  }
  refs.abort.current.set(target.id, new AbortController())
  refs.deliveredSteers.current.set(target.id, new Set(['steer-1']))
  refs.inFlightConfirmation.current.set(target.id, request)
  refs.currentTurnId.current.set(target.id, 'turn-1')
  refs.currentTurnJobId.current.set(target.id, 'job-ref')
  refs.currentTurnRevision.current.set(target.id, 3)

  const input: AgentInterruptSettlementControllerInput = {
    controller: {
      jobId: vi.fn(() => 'job-ctl'),
      turnId: vi.fn(() => 'turn-ctl'),
      finishQueuedTurn: vi.fn(async () => {
        events.push('finishQueued')
        return null
      }),
    },
    activeQueueTurnOf: vi.fn(() => undefined),
    currentIdRef: { current: target.id },
    refs,
    isActivityActive: vi.fn(() => true),
    turnMatchesActivity: vi.fn(() => true),
    queueTurnMatchesActivity: vi.fn(() => true),
    clearQueueDrain: vi.fn(() => {
      events.push('drain')
    }),
    settleSession: vi.fn(async () => {
      events.push('settle')
      return options.settled === undefined ? target : options.settled
    }),
    transitionSessionJob: vi.fn(async () => {
      events.push('transition')
      return null
    }) as unknown as AgentInterruptSettlementControllerInput['transitionSessionJob'],
    removeSteers: vi.fn(async () => {
      events.push('removeSteers')
      return null
    }),
    releaseActivity: vi.fn(() => {
      events.push('releaseActivity')
    }),
    applySessionSnapshot: vi.fn(() => {
      events.push('apply')
    }),
    setMessages: vi.fn(() => {
      events.push('messages')
    }),
    clearLiveActivities: vi.fn(() => {
      events.push('live')
    }),
    clearLiveProcess: vi.fn(() => {
      events.push('process')
    }),
    clearRunTasks: vi.fn(() => {
      events.push('tasks')
    }),
    setStatus: vi.fn(() => {
      events.push('status')
    }),
    notify: vi.fn(() => {
      events.push('notify')
    }),
    ...patch,
  }
  return { input, events, refs }
}

function render(props: AgentInterruptSettlementControllerInput): {
  viewRef: { current: AgentInterruptSettlement | null }
  update: (next: AgentInterruptSettlementControllerInput) => void
} {
  const viewRef: { current: AgentInterruptSettlement | null } = {
    current: null,
  }
  function Probe(next: AgentInterruptSettlementControllerInput) {
    viewRef.current = useAgentInterruptSettlementController(next)
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

describe('useAgentInterruptSettlementController / 装配与顺序', () => {
  it('abort → clearDrain → settle → transition → release → UI，且不误 notify', async () => {
    const { input, events, refs } = harness()
    const turnAbort = refs.abort.current.get('s1')!
    const { viewRef } = render(input)

    await act(async () => {
      await viewRef.current!(session('s1'), request, 'canceled')
    })

    expect(events).toEqual([
      'drain',
      'settle',
      'transition',
      'releaseActivity',
      'apply',
      'messages',
      'live',
      'process',
      'tasks',
      'status',
    ])
    // abort 在 settle 之前（否则迟到的 handleOutcome 会把确认卡写回来）；
    // ref 本身随后会在 deletePerSessionRefs 里被清掉，所以看信号而不是看表。
    expect(turnAbort.signal.aborted).toBe(true)
    expect(input.notify).not.toHaveBeenCalled()
  })

  it('origin 三元回退 + session.messageRevision 优先，直达 settle / transition', async () => {
    const { input } = harness()
    const { viewRef } = render(input)

    await act(async () => {
      await viewRef.current!(session('s1', { messageRevision: 5 }), request, 'canceled')
    })

    expect(input.settleSession).toHaveBeenCalledWith(
      's1',
      request,
      'canceled',
      5,
    )
    expect(input.transitionSessionJob).toHaveBeenCalledWith(
      's1',
      'canceled',
      'interrupted',
      { pendingCallId: undefined },
      { reason: 'user_canceled_confirmation' },
      {
        jobId: 'job-ref',
        turnId: 'turn-1',
        queueTurnId: undefined,
        messageRevision: 5,
      },
    )
  })

  it('队列回合：removeSteers 与 finishQueuedTurn 都绑同一 origin 收口', async () => {
    const { input, events } = harness({
      activeQueueTurnOf: vi.fn(() => 'queue-1'),
    })
    const { viewRef } = render(input)
    const queued = session('s1', {
      messageRevision: 2,
      pendingSteers: [
        { id: 'steer-1', text: '继续', createdAt: 1 },
      ],
    })

    await act(async () => {
      await viewRef.current!(queued, undefined, 'interrupted')
    })

    expect(input.removeSteers).toHaveBeenCalledWith('s1', ['steer-1'])
    expect(input.controller.finishQueuedTurn).toHaveBeenCalledWith(
      's1',
      'queue-1',
      false,
    )
    expect(events.indexOf('removeSteers')).toBeLessThan(
      events.indexOf('finishQueued'),
    )
    expect(input.transitionSessionJob).toHaveBeenCalledWith(
      's1',
      'canceled',
      'interrupted',
      { pendingCallId: undefined },
      { reason: 'user_stopped' },
      expect.objectContaining({ queueTurnId: 'queue-1', turnId: 'queue-1' }),
    )
  })

  it('cleanupError 只 notify 一次（话术不变）', async () => {
    const failure = new Error('cleanup failed')
    const { input } = harness({
      settleSession: vi.fn(async () => {
        throw failure
      }),
    })
    const { viewRef } = render(input)

    let settled: Awaited<ReturnType<AgentInterruptSettlement>> | null = null
    await act(async () => {
      settled = await viewRef.current!(session('s1'), request, 'canceled')
    })

    expect(settled!.cleanupError).toBe(failure)
    expect(input.notify).toHaveBeenCalledTimes(1)
    expect(input.notify).toHaveBeenCalledWith(
      '停止任务时清理状态失败：cleanup failed',
      'error',
    )
  })

  it('非当前会话仍然收口 DB/Job 并应用快照，但不改消息列表', async () => {
    const { input } = harness({ currentIdRef: { current: 's2' } })
    const { viewRef } = render(input)

    await act(async () => {
      await viewRef.current!(session('s1'), request, 'canceled')
    })

    expect(input.settleSession).toHaveBeenCalledTimes(1)
    expect(input.setMessages).not.toHaveBeenCalled()
    expect(input.applySessionSnapshot).toHaveBeenCalledTimes(1)
    expect(input.setStatus).toHaveBeenCalledWith('s1', { kind: 'idle' })
  })
})

describe('useAgentInterruptSettlementController / 六张 per-session 表', () => {
  it('收口后六张全清，重点是 deliveredSteers / inFlightConfirmation / revision', async () => {
    const { input, refs } = harness()
    const { viewRef } = render(input)

    await act(async () => {
      await viewRef.current!(session('s1'), request, 'canceled')
    })

    expect(refs.deliveredSteers.current.has('s1')).toBe(false)
    expect(refs.inFlightConfirmation.current.has('s1')).toBe(false)
    expect(refs.currentTurnRevision.current.has('s1')).toBe(false)
    expect(refs.abort.current.has('s1')).toBe(false)
    expect(refs.currentTurnId.current.has('s1')).toBe(false)
    expect(refs.currentTurnJobId.current.has('s1')).toBe(false)
  })

  it('不误清别的会话', async () => {
    const { input, refs } = harness()
    refs.abort.current.set('s2', new AbortController())
    refs.deliveredSteers.current.set('s2', new Set(['steer-b']))
    refs.currentTurnId.current.set('s2', 'turn-b')
    refs.currentTurnJobId.current.set('s2', 'job-b')
    refs.currentTurnRevision.current.set('s2', 9)
    const { viewRef } = render(input)

    await act(async () => {
      await viewRef.current!(session('s1'), request, 'canceled')
    })

    expect(refs.abort.current.has('s2')).toBe(true)
    expect(refs.deliveredSteers.current.has('s2')).toBe(true)
    expect(refs.currentTurnId.current.get('s2')).toBe('turn-b')
    expect(refs.currentTurnJobId.current.get('s2')).toBe('job-b')
    expect(refs.currentTurnRevision.current.get('s2')).toBe(9)
  })

  it('端口不变时返回的回调身份不变（不因每帧重建拖累下游控制器）', () => {
    const { input } = harness()
    const { viewRef, update } = render(input)
    const first = viewRef.current

    update({ ...input })

    expect(viewRef.current).toBe(first)
  })
})
