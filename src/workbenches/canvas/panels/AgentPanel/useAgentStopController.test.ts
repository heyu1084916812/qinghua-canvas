import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentToolRequest } from '../../agent/agentLoop'
import {
  useAgentStopController,
  type AgentStop,
  type AgentStopControllerInput,
} from './useAgentStopController'

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
  input: AgentStopControllerInput
  stopping: Set<string>
  inFlight: Map<string, AgentToolRequest>
  events: string[]
}

function harness(
  patch: Partial<AgentStopControllerInput> = {},
): Harness {
  const events: string[] = []
  const stopping = new Set<string>()
  const inFlight = new Map<string, AgentToolRequest>()
  const input: AgentStopControllerInput = {
    current: session(),
    status: { kind: 'thinking' },
    inFlightConfirmationRef: { current: inFlight },
    stoppingRef: { current: stopping },
    settleInterruptedSession: vi.fn(async () => {
      events.push('settle')
      return { session: null, cleanupError: undefined }
    }),
    notify: vi.fn((message) => {
      events.push(`notify:${message}`)
    }),
    trackRun: (work) => work(),
    ...patch,
  }
  return { input, stopping, inFlight, events }
}

function render(props: AgentStopControllerInput): {
  viewRef: { current: AgentStop | null }
} {
  const viewRef: { current: AgentStop | null } = { current: null }
  function Probe(next: AgentStopControllerInput) {
    viewRef.current = useAgentStopController(next)
    return null
  }
  act(() => {
    TestRenderer.create(createElement(Probe, props))
  })
  return { viewRef }
}

describe('stop / 守卫与 request 解析', () => {
  it('没有当前会话 / 已经在停 → 不重复收口', async () => {
    const none = harness({ current: null })
    const busy = harness()
    busy.stopping.add('s1')
    /** 对照组：同一个 harness，只把两个守卫条件都去掉 —— 它必须真的收口一次。 */
    const open = harness()

    await render(none.input).viewRef.current!()
    await render(busy.input).viewRef.current!()
    await render(open.input).viewRef.current!()

    expect(none.input.settleInterruptedSession).not.toHaveBeenCalled()
    expect(busy.input.settleInterruptedSession).not.toHaveBeenCalled()
    /**
     * #930：光断言"没调用"证明不了守卫走没走到 —— 钩子整个没跑也满足。
     * ① 守卫返回时**不许动** stopping（动了 finally 就会删掉它，按钮会以为自己空闲）
     * ② 对照组证明这套 harness + 这个钩子是能收口的，差别只在守卫
     */
    expect(busy.stopping.has('s1')).toBe(true)
    expect(open.input.settleInterruptedSession).toHaveBeenCalledTimes(1)
    expect(open.stopping.size).toBe(0)
  })

  it('request 优先级：inFlight 确认 > 确认卡 > undefined', async () => {
    const withInFlight = harness({
      status: { kind: 'awaitingConfirm', request: { ...request, callId: 'card' } },
    })
    withInFlight.inFlight.set('s1', request)

    const cardOnly = harness({
      status: { kind: 'awaitingConfirm', request },
    })
    const nothing = harness()

    await render(withInFlight.input).viewRef.current!()
    await render(cardOnly.input).viewRef.current!()
    await render(nothing.input).viewRef.current!()

    expect(withInFlight.input.settleInterruptedSession).toHaveBeenCalledWith(
      withInFlight.input.current,
      request,
      'interrupted',
    )
    expect(cardOnly.input.settleInterruptedSession).toHaveBeenCalledWith(
      cardOnly.input.current,
      request,
      'interrupted',
    )
    expect(
      (nothing.input.settleInterruptedSession as ReturnType<typeof vi.fn>)
        .mock.calls[0]![1],
    ).toBeUndefined()
  })

  it('确认进行中（inFlight 有值）也能停 —— 不确认卡也不等 confirming', async () => {
    const h = harness({ status: { kind: 'thinking' } })
    h.inFlight.set('s1', request)

    await render(h.input).viewRef.current!()

    expect(h.input.settleInterruptedSession).toHaveBeenCalledTimes(1)
  })
})

describe('stop / 提示条件与释放', () => {
  it('settle → 提示（顺序固定），且只在无 cleanupError 时提示', async () => {
    const h = harness({
      current: session('s1', {
        queuedTurns: [
          {
            id: 'turn-q',
            text: '下一张',
            createdAt: 1,
            channelId: '',
            model: 'GPT-6 Astra',
          },
        ],
      }),
    })

    await render(h.input).viewRef.current!()

    expect(h.events).toEqual([
      'settle',
      'notify:当前回合已停止，排队任务保留；可从队列手动继续',
    ])
  })

  it('cleanupError → 一句提示都不发（不许伪报收尾干净）', async () => {
    const settleInterruptedSession = vi.fn(async () => ({
      session: null,
      cleanupError: new Error('cleanup failed'),
    }))
    const h = harness({
      current: session('s1', {
        queuedTurns: [
          {
            id: 'turn-q',
            text: '下一张',
            createdAt: 1,
            channelId: '',
            model: 'GPT-6 Astra',
          },
        ],
      }),
      settleInterruptedSession,
    })

    await render(h.input).viewRef.current!()

    // #930：先证明收口**真的发生了**（只差"该不该提示"这一个分支）
    expect(settleInterruptedSession).toHaveBeenCalledTimes(1)
    expect(settleInterruptedSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      undefined,
      'interrupted',
    )
    expect(h.input.notify).not.toHaveBeenCalled()
  })

  it('没有排队任务时也不提示', async () => {
    const h = harness()

    await render(h.input).viewRef.current!()

    // #930：同上，先证明收口发生了
    expect(h.events).toEqual(['settle'])
    expect(h.input.notify).not.toHaveBeenCalled()
  })

  it('settle 抛错：promise 上抛，但 stopping 仍然释放', async () => {
    const h = harness({
      settleInterruptedSession: vi.fn(async () => {
        throw new Error('settle failed')
      }),
    })

    await expect(render(h.input).viewRef.current!()).rejects.toThrow(
      'settle failed',
    )
    expect(h.stopping.has('s1')).toBe(false)
  })

  it('正常结束后释放 stopping', async () => {
    const h = harness()

    await render(h.input).viewRef.current!()

    expect(h.stopping.has('s1')).toBe(false)
  })
})
