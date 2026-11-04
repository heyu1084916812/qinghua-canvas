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
  notifyCleanupFailure?: (message: string) => void
  logCleanupFailure?: (detail: {
    sessionId: string
    attempts: number
    error: unknown
  }) => void
  wait?: (ms: number) => Promise<void>
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
        notifyCleanupFailure: config.notifyCleanupFailure,
        logCleanupFailure: config.logCleanupFailure,
        wait: config.wait,
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
      wait: async () => undefined,
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

/**
 * 孤儿会话清理：清理是**旁路**，不许阻断启动、不许刷屏、不许放宽判定。
 */
describe('runAgentInitialLoad / 孤儿清理失败回收', () => {
  /**
   * 复现「初始加载建了空会话、用户随后新建了会话」的接管时刻，
   * 返回初始加载的 promise，等调用方决定 removeSession 的行为。
   */
  function startTakeOver(config: {
    sessionsRemove: (sessionId: string) => Promise<void>
    notifyCleanupFailure?: (message: string) => void
    logCleanupFailure?: (detail: {
      sessionId: string
      attempts: number
      error: unknown
    }) => void
    wait?: (ms: number) => Promise<void>
  }) {
    const initialCreate = deferred<AgentSession>()
    const userSession = session('user')
    const harness = mountHarness({
      controllerRefresh: vi
        .fn<() => Promise<AgentSession[]>>()
        .mockImplementationOnce(async () => [])
        .mockImplementationOnce(async () => [userSession]),
      getSession: async (sessionId) =>
        sessionId === userSession.id ? userSession : null,
      createUserSession: async () => userSession,
      createInitialSession: vi.fn(() => initialCreate.promise),
      sessionsRemove: config.sessionsRemove,
      ...(config.notifyCleanupFailure
        ? { notifyCleanupFailure: config.notifyCleanupFailure }
        : {}),
      ...(config.logCleanupFailure
        ? { logCleanupFailure: config.logCleanupFailure }
        : {}),
      ...(config.wait ? { wait: config.wait } : {}),
    })
    return { harness, initialCreate, userSession }
  }

  async function takeOver(
    harness: ReturnType<typeof mountHarness>,
    initialCreate: ReturnType<typeof deferred<AgentSession>>,
  ): Promise<Promise<AgentInitialLoadOutcome>> {
    let initialLoad!: Promise<AgentInitialLoadOutcome>
    act(() => {
      initialLoad = harness.initialLoadRef.current!()
    })
    await vi.waitFor(() => {
      expect(harness.lifecycleRef.current).not.toBeNull()
    })
    await act(async () => {
      await harness.actionsRef.current!.newSession()
    })
    /**
     * 故意**不套 act**：清理重试可能长时间挂起（本文件里用 deferred 控制），
     * 套进 act 会让 act 等这条旁路链走完。
     */
    initialCreate.resolve(session('initial-created'))
    return initialLoad
  }

  it('第一次失败、第二次成功：最终删掉，且不打扰用户', async () => {
    const sessionsRemove = vi
      .fn<(sessionId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce(undefined)
    const notifyCleanupFailure = vi.fn()
    const logCleanupFailure = vi.fn<
      (detail: { sessionId: string; attempts: number; error: unknown }) => void
    >()
    const { harness, initialCreate } = startTakeOver({
      sessionsRemove,
      notifyCleanupFailure,
      logCleanupFailure,
      wait: async () => undefined,
    })

    const initialLoad = await takeOver(harness, initialCreate)
    let outcome!: AgentInitialLoadOutcome
    await act(async () => {
      outcome = await initialLoad
    })

    expect(sessionsRemove).toHaveBeenCalledTimes(2)
    expect(sessionsRemove).toHaveBeenNthCalledWith(1, 'initial-created')
    expect(sessionsRemove).toHaveBeenNthCalledWith(2, 'initial-created')
    expect(outcome).toMatchObject({
      kind: 'stale',
      discardedSessionId: 'initial-created',
    })
    expect(outcome).not.toHaveProperty('cleanupError')
    expect(notifyCleanupFailure).not.toHaveBeenCalled()
    expect(logCleanupFailure).not.toHaveBeenCalled()
    expect(harness.lifecycleRef.current!.current?.id).toBe('user')
  })

  it('一直失败：只提示一次、只记一条带 sessionId 的日志，启动照常', async () => {
    const failure = new Error('cleanup failed')
    const sessionsRemove = vi.fn(async () => {
      throw failure
    })
    const notifyCleanupFailure = vi.fn()
    const logCleanupFailure = vi.fn()
    const { harness, initialCreate } = startTakeOver({
      sessionsRemove,
      notifyCleanupFailure,
      logCleanupFailure,
      wait: async () => undefined,
    })

    const initialLoad = await takeOver(harness, initialCreate)
    let outcome!: AgentInitialLoadOutcome
    await act(async () => {
      outcome = await initialLoad
    })

    expect(sessionsRemove.mock.calls.length).toBeGreaterThan(1)
    // 提示只发一次，不随重试次数刷屏
    expect(notifyCleanupFailure).toHaveBeenCalledTimes(1)
    expect(notifyCleanupFailure).toHaveBeenCalledWith(
      expect.stringContaining('会话'),
    )
    expect(logCleanupFailure).toHaveBeenCalledTimes(1)
    expect(logCleanupFailure.mock.calls[0]![0]).toMatchObject({
      sessionId: 'initial-created',
      error: failure,
    })
    expect(outcome).toMatchObject({
      kind: 'stale',
      discardedSessionId: 'initial-created',
      cleanupError: failure,
    })
    // 启动照常：用户选中的会话仍在、列表里没有幽灵
    expect(harness.lifecycleRef.current!.current?.id).toBe('user')
    expect(harness.lifecycleRef.current!.list.map((item) => item.id)).toEqual([
      'user',
    ])
  })

  it('重试之间不阻塞：等待期间会话已经可用，且不会重复发起删除', async () => {
    /**
     * 这一条用纯端口驱动（不挂 React）：要证明的是「重试等待不阻塞」，
     * 而 act 会等异步更新收尾，反而看不出旁路是否独立。
     */
    const waitGate = deferred<void>()
    const waitDelays: number[] = []
    const currentIdRef: { current: string | null } = { current: null }
    const removedIds: string[] = []

    const initialLoad = runAgentInitialLoad({
      isAlive: () => true,
      currentIdRef,
      selectionVersionRef: { current: 0 },
      refresh: async () => ({ rows: [], applied: true }),
      loadReviewModel: async () => null,
      loadCanvasReview: async () => false,
      setReviewModel: () => undefined,
      setCanvasReview: () => undefined,
      getSession: async () => null,
      createSession: async () => {
        /** 建出空会话的同时用户就接管了选择。 */
        currentIdRef.current = 'user'
        return session('initial-created')
      },
      removeSession: async (sessionId) => {
        removedIds.push(sessionId)
        throw new Error('cleanup failed')
      },
      setList: () => undefined,
      setCurrent: () => undefined,
      setMessages: () => undefined,
      wait: (ms) => {
        waitDelays.push(ms)
        return waitGate.promise
      },
    })

    let settled = false
    void initialLoad.then(() => {
      settled = true
    })

    // 推进到「第一次删除失败、卡在重试等待上」这一拍
    for (let tick = 0; tick < 30 && waitDelays.length === 0; tick += 1) {
      await Promise.resolve()
    }
    expect(removedIds).toEqual(['initial-created'])
    expect(settled).toBe(false)
    expect(waitDelays).toHaveLength(1)

    // 旁路等待期间，别的工作照常能推进
    let otherWorkDone = false
    const otherWork = Promise.resolve().then(() => {
      otherWorkDone = true
    })
    await otherWork
    expect(otherWorkDone).toBe(true)
    // 等待期间不重复发起删除
    expect(removedIds).toEqual(['initial-created'])
    expect(settled).toBe(false)

    waitGate.resolve()
    await initialLoad
    expect(removedIds.length).toBeGreaterThan(1)
    expect(settled).toBe(true)
  })

  it('判定条件没放宽：只删被丢弃的那条，其它会话一条不动', async () => {
    const sessionsRemove = vi.fn<(sessionId: string) => Promise<void>>(
      async () => undefined,
    )
    const { harness, initialCreate } = startTakeOver({
      sessionsRemove,
      wait: async () => undefined,
    })

    const initialLoad = await takeOver(harness, initialCreate)
    await act(async () => {
      await initialLoad
    })

    expect(sessionsRemove).toHaveBeenCalledTimes(1)
    const removedIds = sessionsRemove.mock.calls.map(([sessionId]) => sessionId)
    expect(removedIds).toEqual(['initial-created'])
    expect(removedIds).not.toContain('user')
  })
})
