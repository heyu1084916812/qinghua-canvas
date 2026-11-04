import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { IDLE_STATUS, type AgentPanelStatus } from './AgentActivityViews'
import {
  useAgentAutoRunController,
  type AgentAutoRunControllerInput,
} from './useAgentAutoRunController'

type Hook = ReturnType<typeof useAgentAutoRunController>

function session(id: string, autoRun = false): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model: 'GPT-6 Astra',
    autoRun,
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function input(
  patch: Partial<AgentAutoRunControllerInput> = {},
): AgentAutoRunControllerInput {
  return {
    current: session('s1'),
    statusFor: vi.fn(() => IDLE_STATUS),
    patchSession: vi.fn(async (sessionId, values) => ({
      ...session(sessionId),
      ...values,
    })),
    confirmLatest: vi.fn(async () => undefined),
    isCurrentSession: vi.fn(() => true),
    ...patch,
  }
}

function render(props: AgentAutoRunControllerInput): {
  viewRef: { current: Hook | null }
  update: (next: AgentAutoRunControllerInput) => void
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe(next: AgentAutoRunControllerInput) {
    viewRef.current = useAgentAutoRunController(next)
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('useAgentAutoRunController', () => {
  it('成功开启/关闭 autoRun，不触发 confirm', async () => {
    const patchSession = vi.fn(async (sessionId, values) => ({
      ...session(sessionId),
      ...values,
    }))
    const confirmLatest = vi.fn(async () => undefined)
    const { viewRef } = render(input({ patchSession, confirmLatest }))

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(true)).resolves.toBe(true)
    })
    expect(patchSession).toHaveBeenCalledWith('s1', { autoRun: true })
    expect(viewRef.current!.autoRunFor('s1')).toBe(true)
    expect(confirmLatest).not.toHaveBeenCalled()

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(false)).resolves.toBe(true)
    })
    expect(viewRef.current!.autoRunFor('s1')).toBe(false)
  })

  it('patch 返回 null 时回滚实时值且不 confirm', async () => {
    const confirmLatest = vi.fn(async () => undefined)
    const { viewRef } = render(
      input({
        current: session('s1', true),
        patchSession: vi.fn(async () => null),
        confirmLatest,
      }),
    )
    viewRef.current!.syncFromSession(session('s1', true))

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(false)).resolves.toBe(false)
    })
    expect(viewRef.current!.autoRunFor('s1')).toBe(true)
    expect(confirmLatest).not.toHaveBeenCalled()
  })

  it('patch reject 时回滚并保留原错误，不 confirm', async () => {
    const error = new Error('write failed')
    const confirmLatest = vi.fn(async () => undefined)
    const { viewRef } = render(
      input({
        current: session('s1', true),
        patchSession: vi.fn(async () => {
          throw error
        }),
        confirmLatest,
      }),
    )
    viewRef.current!.syncFromSession(session('s1', true))

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(false)).rejects.toBe(error)
    })
    expect(viewRef.current!.autoRunFor('s1')).toBe(true)
    expect(confirmLatest).not.toHaveBeenCalled()
  })

  it('显式审批工具即使 awaitingConfirm 也不自动确认', async () => {
    const confirmLatest = vi.fn(async () => undefined)
    const statusFor = vi.fn((): AgentPanelStatus => ({
      kind: 'awaitingConfirm',
      request: {
        callId: 'call-1',
        name: 'node.delete',
        args: {},
      },
    }))
    const { viewRef } = render(
      input({
        statusFor,
        patchSession: vi.fn(async (sessionId, values) => ({
          ...session(sessionId),
          ...values,
        })),
        confirmLatest,
      }),
    )

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(true)).resolves.toBe(true)
    })
    expect(statusFor).toHaveBeenCalledWith('s1')
    expect(confirmLatest).not.toHaveBeenCalled()
  })

  it('非 awaitingConfirm 不自动确认', async () => {
    const confirmLatest = vi.fn(async () => undefined)
    const { viewRef } = render(
      input({
        statusFor: vi.fn(() => IDLE_STATUS),
        confirmLatest,
      }),
    )

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(true)).resolves.toBe(true)
    })
    expect(confirmLatest).not.toHaveBeenCalled()
  })

  it('只有 patch 成功后才自动确认，且 settings 不回滚', async () => {
    const patch = deferred<AgentSession | null>()
    const events: string[] = []
    const confirmLatest = vi.fn(async () => {
      events.push('confirm')
    })
    const statusFor = vi.fn((): AgentPanelStatus => ({
      kind: 'awaitingConfirm',
      request: {
        callId: 'call-review',
        name: 'requestTaskConfirmation',
        args: { purpose: 'review' },
      },
    }))
    const { viewRef } = render(
      input({
        statusFor,
        patchSession: vi.fn(() => {
          events.push('patch-start')
          return patch.promise
        }),
        confirmLatest,
      }),
    )

    let saving!: Promise<boolean>
    act(() => {
      saving = viewRef.current!.setAutoRun(true)
    })
    expect(events).toEqual(['patch-start'])
    expect(confirmLatest).not.toHaveBeenCalled()

    await act(async () => {
      patch.resolve(session('s1', true))
      await expect(saving).resolves.toBe(true)
    })
    expect(events).toEqual(['patch-start', 'confirm'])
    expect(viewRef.current!.autoRunFor('s1')).toBe(true)
  })

  it('A patch 挂起时切到 B，完成后不得确认 B', async () => {
    const patch = deferred<AgentSession | null>()
    const confirmLatest = vi.fn(async () => undefined)
    const statusFor = vi.fn((): AgentPanelStatus => ({
      kind: 'awaitingConfirm',
      request: {
        callId: 'call-review',
        name: 'requestTaskConfirmation',
        args: { purpose: 'review' },
      },
    }))
    let currentId = 'a'
    const props = input({
      current: session('a'),
      statusFor,
      patchSession: vi.fn(() => patch.promise),
      confirmLatest,
      isCurrentSession: (sessionId) => sessionId === currentId,
    })
    const { viewRef, update } = render(props)

    let saving!: Promise<boolean>
    act(() => {
      saving = viewRef.current!.setAutoRun(true)
    })
    currentId = 'b'
    update({ ...props, current: session('b') })

    await act(async () => {
      patch.resolve(session('a', true))
      await expect(saving).resolves.toBe(true)
    })
    expect(confirmLatest).not.toHaveBeenCalled()
    expect(viewRef.current!.autoRunFor('a')).toBe(true)
    expect(viewRef.current!.autoRunFor('b')).toBe(false)
  })

  it('patch 完成后最新 status 已不是可自动确认卡时不 confirm', async () => {
    const confirmLatest = vi.fn(async () => undefined)
    const statusFor = vi
      .fn<(sessionId: string) => AgentPanelStatus>()
      .mockReturnValueOnce({
        kind: 'awaitingConfirm',
        request: {
          callId: 'call-review',
          name: 'requestTaskConfirmation',
          args: { purpose: 'review' },
        },
      })
      .mockReturnValueOnce(IDLE_STATUS)
    const { viewRef } = render(
      input({
        statusFor,
        confirmLatest,
      }),
    )

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(true)).resolves.toBe(true)
    })
    expect(statusFor).toHaveBeenCalledTimes(2)
    expect(confirmLatest).not.toHaveBeenCalled()
  })

  it('A/B autoRun Map 隔离', async () => {
    const { viewRef, update } = render(input())
    viewRef.current!.syncFromSession(session('a', true))
    viewRef.current!.syncFromSession(session('b', false))
    expect(viewRef.current!.autoRunFor('a')).toBe(true)
    expect(viewRef.current!.autoRunFor('b')).toBe(false)

    update(input({ current: session('b') }))
    await act(async () => {
      await viewRef.current!.setAutoRun(true)
    })
    expect(viewRef.current!.autoRunFor('a')).toBe(true)
    expect(viewRef.current!.autoRunFor('b')).toBe(true)
  })

  it('syncFromSession 覆盖实时值，clearAutoRuns 全部清除', () => {
    const { viewRef } = render(input())
    viewRef.current!.syncFromSession(session('s1', false))
    expect(viewRef.current!.autoRunFor('s1')).toBe(false)

    viewRef.current!.syncFromSession(session('s1', true))
    expect(viewRef.current!.autoRunFor('s1')).toBe(true)
    viewRef.current!.syncFromSession(session('s1', false))
    expect(viewRef.current!.autoRunFor('s1')).toBe(false)

    viewRef.current!.syncFromSession(session('s2', true))
    viewRef.current!.clearAutoRuns()
    expect(viewRef.current!.autoRunFor('s1')).toBe(false)
    expect(viewRef.current!.autoRunFor('s2')).toBe(false)
  })

  it('current 为空时 no-op 返回 false', async () => {
    const patchSession = vi.fn()
    const confirmLatest = vi.fn()
    const { viewRef } = render(
      input({ current: null, patchSession, confirmLatest }),
    )

    await act(async () => {
      await expect(viewRef.current!.setAutoRun(true)).resolves.toBe(false)
    })
    expect(patchSession).not.toHaveBeenCalled()
    expect(confirmLatest).not.toHaveBeenCalled()
  })
})
