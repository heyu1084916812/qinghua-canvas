import { createElement, useEffect, useRef } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  TaskLifecycleClosedError,
  TaskLifecycleTimeoutError,
  createTaskLifecycle,
} from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentSendText } from './useAgentQueueController'
import { useAgentSendController } from './useAgentSendController'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const session = {
  id: 'session-p1',
  projectId: 'p1',
  title: 'test',
  channelId: 'channel',
  model: 'model',
  queuedTurns: [],
  pendingSteers: [],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
} as AgentSession

describe('useAgentSendController lifecycle', () => {
  it('dispose 后 send 拒绝新工作，并等待已开始的完整发送 Promise', async () => {
    const lifecycle = createTaskLifecycle()
    const gate = deferred<void>()
    let sendText!: AgentSendText

    function Probe() {
      const currentIdRef = useRef<string | null>(session.id)
      const stickToLatestRef = useRef(true)
      const abortRefs = useRef(new Map<string, AbortController>())
      const deliveredSteersRef = useRef(new Map<string, Set<string>>())
      const queuePumpRef = useRef<(sessionId: string) => void>(() => {})
      sendText = useAgentSendController({
        current: session,
        currentIdRef,
        stickToLatestRef,
        setShowJumpToLatest: vi.fn(),
        controller: {
          finishQueuedTurn: vi.fn(async () => null),
        } as never,
        abortRefs,
        deliveredSteersRef,
        runSendText: async () => {
          await gate.promise
          return undefined
        },
        applySessionSnapshot: vi.fn(),
        clearLiveActivitiesFor: vi.fn(),
        clearLiveProcessFor: vi.fn(),
        clearRunTasksFor: vi.fn(),
        setStatusFor: vi.fn(),
        transitionSessionJob: vi.fn(async () => null) as never,
        queuePumpRef,
        trackRun: (work) => lifecycle.track(work),
      })
      useEffect(() => undefined, [])
      return null
    }

    let root!: TestRenderer.ReactTestRenderer
    act(() => {
      root = TestRenderer.create(createElement(Probe))
    })
    let first!: Promise<unknown>
    act(() => {
      first = sendText('first')
    })
    await Promise.resolve()

    lifecycle.beginClose()
    await expect(sendText('second')).rejects.toBeInstanceOf(
      TaskLifecycleClosedError,
    )
    await expect(
      lifecycle.waitForIdle(5),
    ).rejects.toBeInstanceOf(TaskLifecycleTimeoutError)

    gate.resolve()
    await act(async () => {
      await first
    })
    await lifecycle.waitForIdle(100)
    act(() => root.unmount())
  })
})
