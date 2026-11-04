import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { interruptOriginFor } from './agentInterruptOrigin'
import { outcomeTurnOriginFor } from './agentOutcomeOrigin'
import type { PersistedAgentUserTurn } from './agentTurnPersistence'

function session(patch: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    projectId: 'p1',
    title: '会话 s1',
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

function persisted(messageRevision: number): PersistedAgentUserTurn {
  return {
    modelWindow: [],
    userMessage: { role: 'user', content: '画一张' },
    historyMessages: [{ role: 'user', content: '画一张' }],
    outcomeTailIndex: 0,
    saved: session(),
    messageRevision,
  }
}

function harness(options: {
  persistedTurn?: PersistedAgentUserTurn
  sessionRevision?: number
  refJobId?: string
  refTurnId?: string
  refRevision?: number
  controllerJobId?: string
  controllerTurnId?: string
  queueTurnId?: string
} = {}) {
  const refs = {
    currentTurnJobId: { current: new Map<string, string>() },
    currentTurnId: { current: new Map<string, string>() },
    currentTurnRevision: { current: new Map<string, number>() },
  }
  if (options.refJobId) refs.currentTurnJobId.current.set('s1', options.refJobId)
  if (options.refTurnId) refs.currentTurnId.current.set('s1', options.refTurnId)
  if (options.refRevision !== undefined) {
    refs.currentTurnRevision.current.set('s1', options.refRevision)
  }
  const controller = {
    jobId: vi.fn(() => options.controllerJobId),
    turnId: vi.fn(() => options.controllerTurnId),
  }
  const input = {
    persistedTurn: options.persistedTurn,
    session: session(
      options.sessionRevision === undefined
        ? {}
        : { messageRevision: options.sessionRevision },
    ),
    refs,
    controller,
    activeQueueTurnOf: () => options.queueTurnId,
  }
  return { input }
}

describe('outcomeTurnOriginFor / messageRevision 三层回退', () => {
  const cases: Array<{
    label: string
    persistedRevision?: number
    sessionRevision?: number
    refRevision?: number
    expected: number | undefined
  }> = [
    {
      label: '落库回写的 persistedTurn 优先（session / ref 都有别的值）',
      persistedRevision: 42,
      sessionRevision: 7,
      refRevision: 3,
      expected: 42,
    },
    {
      label: '没有 persistedTurn → 用会话上的持久值',
      sessionRevision: 7,
      refRevision: 3,
      expected: 7,
    },
    {
      label: '会话没有 revision → 用本轮 ref',
      refRevision: 3,
      expected: 3,
    },
    {
      label: '三者都没有 → undefined',
      expected: undefined,
    },
  ]

  it.each(cases)('$label', (c) => {
    const { input } = harness({
      persistedTurn:
        c.persistedRevision === undefined
          ? undefined
          : persisted(c.persistedRevision),
      sessionRevision: c.sessionRevision,
      refRevision: c.refRevision,
    })

    expect(outcomeTurnOriginFor(input).messageRevision).toBe(c.expected)
  })
})

describe('outcomeTurnOriginFor / jobId 与 turnId 回退链', () => {
  it('jobId：本轮 ref 优先，其次 controller', () => {
    const both = harness({ refJobId: 'job-ref', controllerJobId: 'job-ctl' })
    expect(outcomeTurnOriginFor(both.input).jobId).toBe('job-ref')

    const ctlOnly = harness({ controllerJobId: 'job-ctl' })
    expect(outcomeTurnOriginFor(ctlOnly.input).jobId).toBe('job-ctl')

    const none = harness()
    expect(outcomeTurnOriginFor(none.input).jobId).toBeUndefined()
  })

  it('turnId：队列回合优先，其次本轮 ref，最后 controller', () => {
    const queued = harness({
      queueTurnId: 'queue-9',
      refTurnId: 'turn-ref',
      controllerTurnId: 'turn-ctl',
    })
    expect(outcomeTurnOriginFor(queued.input).turnId).toBe('queue-9')

    const direct = harness({
      refTurnId: 'turn-ref',
      controllerTurnId: 'turn-ctl',
    })
    expect(outcomeTurnOriginFor(direct.input).turnId).toBe('turn-ref')

    const ctlOnly = harness({ controllerTurnId: 'turn-ctl' })
    expect(outcomeTurnOriginFor(ctlOnly.input).turnId).toBe('turn-ctl')
  })

  it('queueTurnId 原样透传（没有时键仍存在且为 undefined）', () => {
    const queued = harness({ queueTurnId: 'queue-9' })
    expect(outcomeTurnOriginFor(queued.input).queueTurnId).toBe('queue-9')

    const none = harness()
    const origin = outcomeTurnOriginFor(none.input)
    expect('queueTurnId' in origin).toBe(true)
    expect(origin.queueTurnId).toBeUndefined()
  })
})

describe('outcomeTurnOriginFor / 与 interruptOriginFor 同源', () => {
  it('同输入下 jobId / turnId / queueTurnId 完全一致，只有 revision 多一层', () => {
    const h = harness({
      persistedTurn: persisted(42),
      sessionRevision: 7,
      refJobId: 'job-ref',
      refTurnId: 'turn-ref',
      refRevision: 3,
      controllerJobId: 'job-ctl',
      controllerTurnId: 'turn-ctl',
      queueTurnId: 'queue-9',
    })

    const outcome = outcomeTurnOriginFor(h.input)
    const interrupt = interruptOriginFor({
      session: h.input.session,
      refs: h.input.refs,
      controller: h.input.controller,
      activeQueueTurnOf: h.input.activeQueueTurnOf,
    })

    expect(outcome.jobId).toBe(interrupt.jobId)
    expect(outcome.turnId).toBe(interrupt.turnId)
    expect(outcome.queueTurnId).toBe(interrupt.queueTurnId)
    // 唯一差别：收口优先用"落库后"的那个 revision
    expect(outcome.messageRevision).toBe(42)
    expect(interrupt.messageRevision).toBe(7)
  })
})
