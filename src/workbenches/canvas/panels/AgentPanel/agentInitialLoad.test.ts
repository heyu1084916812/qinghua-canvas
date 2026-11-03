import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  runAgentInitialLoad,
  type AgentInitialLoadOutcome,
} from './agentInitialLoad'
import { useAgentSessionActionsController } from './useAgentSessionActionsController'
import {
  useAgentSessionLifecycle,
  type AgentSessionRefreshResult,
} from './useAgentSessionLifecycle'

function session(id: string): AgentSession {
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function mountHarness(config: {
  controllerRefresh: () => Promise<AgentSession[]>
  getSession: (sessionId: string) => Promise<AgentSession | null>
  createUserSession: () => Promise<AgentSession>
  createInitialSession: (
    canCommit: () => boolean,
  ) => Promise<AgentSession | null>
  sessionsRemove: (sessionId: string) => Promise<void>
}) {
  const lifecycleRef: {
    current: ReturnType<typeof useAgentSessionLifecycle> | null
  } = { current: null }
  const actionsRef: {
    current: ReturnType<typeof useAgentSessionActionsController> | null
  } = { current: null }
  const initialLoadRef: {
    current: (() => Promise<AgentInitialLoadOutcome>) | null
  } = { current: null }
  const track = <T,>(work: () => Promise<T>) => work()

  function Probe() {
    const lifecycle = useAgentSessionLifecycle({
      track,
      controllerRefresh: config.controllerRefresh,
      sessionsGet: config.getSession,
      sessionsMessagesFor: async () => [],
      sessionsUpdateFields: async () => null,
      sessionsRename: async () => undefined,
      sessionsRemove: config.sessionsRemove,
      onSwitched: vi.fn(),
    })
    lifecycleRef.current = lifecycle
    actionsRef.current = useAgentSessionActionsController({
      current: lifecycle.current,
      projectId: 'p1',
      chatModelOptions: ['GPT-6 Astra'],
      imageModelOptions: [],
      videoModelOptions: [],
      trackRun: track,
      createSession: config.createUserSession,
      loadAgentDefault: async () => null,
      logicalModelOf: (model) => model,
      defaultModelFor: (options, saved) =>
        saved && options.includes(saved) ? saved : (options[0] ?? ''),
      selectedModelOf: () => '',
      refresh: lifecycle.refresh,
      switchTo: lifecycle.switchTo,
      setCurrent: lifecycle.setCurrent,
      clearInvalidCurrent: (sessionId) => {
        lifecycle.setList((previous) =>
          previous.filter((item) => item.id !== sessionId),
        )
        if (lifecycle.currentIdRef.current !== sessionId) return
        lifecycle.setCurrent(null)
        lifecycle.setMessages([])
      },
      renameSession: async () => undefined,
      removeSession: lifecycle.removeSession,
      clearDraftForSession: () => {},
      clearSessionRuntime: () => {},
      isCurrentSession: (sessionId) =>
        lifecycle.currentIdRef.current === sessionId,
      isDeleteBlocked: () => false,
      describeError: (error) =>
        error instanceof Error ? error.message : String(error),
      notify: vi.fn(),
    })
    initialLoadRef.current = () =>
      runAgentInitialLoad({
        isAlive: () => true,
        currentIdRef: lifecycle.currentIdRef,
        selectionVersionRef: lifecycle.selectionVersionRef,
        refresh: lifecycle.refresh,
        loadReviewModel: async () => null,
        loadCanvasReview: async () => false,
        setReviewModel: vi.fn(),
        setCanvasReview: vi.fn(),
        getSession: config.getSession,
        createSession: config.createInitialSession,
        removeSession: lifecycle.removeSession,
        setList: lifecycle.setList,
        setCurrent: (next) => lifecycle.setCurrent(next),
        setMessages: lifecycle.setMessages,
      })
    return null
  }

  act(() => {
    TestRenderer.create(createElement(Probe))
  })
  return { lifecycleRef, actionsRef, initialLoadRef }
}

describe('runAgentInitialLoad', () => {
  it('用户在 sessions.get 等待期间新建会话，旧初始加载不得覆盖', async () => {
    const oldSession = session('old')
    const newSession = session('new')
    const oldGet = deferred<AgentSession | null>()
    const controllerRefresh = vi
      .fn<() => Promise<AgentSession[]>>()
      .mockImplementationOnce(async () => [oldSession])
      .mockImplementationOnce(async () => [newSession])
    const getSession = vi.fn((sessionId: string) =>
      sessionId === oldSession.id
        ? oldGet.promise
        : Promise.resolve(newSession),
    )
    const harness = mountHarness({
      controllerRefresh,
      getSession,
      createUserSession: async () => newSession,
      createInitialSession: async () => newSession,
      sessionsRemove: async () => undefined,
    })

    let initialLoad!: Promise<AgentInitialLoadOutcome>
    act(() => {
      initialLoad = harness.initialLoadRef.current!()
    })
    await vi.waitFor(() => {
      expect(getSession).toHaveBeenCalledWith('old')
    })

    await act(async () => {
      await harness.actionsRef.current!.newSession()
    })
    expect(harness.lifecycleRef.current!.current?.id).toBe('new')
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'new',
    ])

    await act(async () => {
      oldGet.resolve(oldSession)
      await expect(initialLoad).resolves.toMatchObject({ kind: 'stale' })
    })
    expect(harness.lifecycleRef.current!.current?.id).toBe('new')
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'new',
    ])
  })

  it('孤儿已进入用户列表时，删除后晚 refresh 也不能复活', async () => {
    const initialCreate = deferred<AgentSession>()
    const initialSession = session('initial-created')
    const userSession = session('user')
    const createInitialSession = vi.fn(() => initialCreate.promise)
    const sessionsRemove = vi.fn(async () => undefined)
    const controllerRefresh = vi
      .fn<() => Promise<AgentSession[]>>()
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => [initialSession, userSession])
      .mockImplementationOnce(async () => [initialSession, userSession])
    const harness = mountHarness({
      controllerRefresh,
      getSession: async (sessionId) =>
        sessionId === userSession.id ? userSession : null,
      createUserSession: async () => userSession,
      createInitialSession,
      sessionsRemove,
    })

    let initialLoad!: Promise<AgentInitialLoadOutcome>
    act(() => {
      initialLoad = harness.initialLoadRef.current!()
    })
    await vi.waitFor(() => {
      expect(createInitialSession).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await harness.actionsRef.current!.newSession()
    })
    expect(harness.lifecycleRef.current!.current?.id).toBe('user')
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'initial-created',
      'user',
    ])

    let outcome!: AgentInitialLoadOutcome
    await act(async () => {
      initialCreate.resolve(initialSession)
      outcome = await initialLoad
    })
    expect(outcome).toMatchObject({
      kind: 'stale',
      discardedSessionId: 'initial-created',
    })
    expect(outcome).not.toHaveProperty('cleanupError')
    expect(sessionsRemove).toHaveBeenCalledTimes(1)
    expect(sessionsRemove).toHaveBeenCalledWith('initial-created')
    expect(harness.lifecycleRef.current!.current?.id).toBe('user')
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'user',
    ])

    let lateRefresh!: AgentSessionRefreshResult
    await act(async () => {
      lateRefresh = await harness.lifecycleRef.current!.refresh()
    })
    expect(lateRefresh.rows.map((item) => item.id)).toEqual(['user'])
    expect(harness.lifecycleRef.current!.current?.id).toBe('user')
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'user',
    ])
  })

  it('初始化孤儿清理失败时保持用户选择并保留错误', async () => {
    const initialCreate = deferred<AgentSession>()
    const userSession = session('user')
    const cleanupError = new Error('cleanup failed')
    const sessionsRemove = vi.fn(async () => {
      throw cleanupError
    })
    const createInitialSession = vi.fn(() => initialCreate.promise)
    const controllerRefresh = vi
      .fn<() => Promise<AgentSession[]>>()
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(async () => [userSession])
    const harness = mountHarness({
      controllerRefresh,
      getSession: async (sessionId) =>
        sessionId === userSession.id ? userSession : null,
      createUserSession: async () => userSession,
      createInitialSession,
      sessionsRemove,
    })

    let initialLoad!: Promise<AgentInitialLoadOutcome>
    act(() => {
      initialLoad = harness.initialLoadRef.current!()
    })
    await vi.waitFor(() => {
      expect(createInitialSession).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await harness.actionsRef.current!.newSession()
    })
    await act(async () => {
      initialCreate.resolve(session('initial-created'))
      await expect(initialLoad).resolves.toMatchObject({
        kind: 'stale',
        discardedSessionId: 'initial-created',
        cleanupError,
      })
    })

    expect(sessionsRemove).toHaveBeenCalledWith('initial-created')
    expect(harness.lifecycleRef.current!.current?.id).toBe('user')
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'user',
    ])
  })

  it('无用户接管时正常保留唯一初始会话且不触发清理', async () => {
    const initialSession = session('initial-created')
    const createInitialSession = vi.fn(async () => initialSession)
    const sessionsRemove = vi.fn(async () => undefined)
    const controllerRefresh = vi.fn(async () => [])
    const harness = mountHarness({
      controllerRefresh,
      getSession: async () => null,
      createUserSession: async () => session('unused'),
      createInitialSession,
      sessionsRemove,
    })

    await act(async () => {
      await expect(
        harness.initialLoadRef.current!(),
      ).resolves.toMatchObject({
        kind: 'created',
        session: { id: 'initial-created' },
      })
    })

    expect(createInitialSession).toHaveBeenCalledTimes(1)
    expect(sessionsRemove).not.toHaveBeenCalled()
    expect(harness.lifecycleRef.current!.current?.id).toBe(
      'initial-created',
    )
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'initial-created',
    ])
  })
})
