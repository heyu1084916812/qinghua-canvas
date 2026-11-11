import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  useAgentSessionLifecycle,
  type AgentSessionLifecycleInput,
  type AgentSessionRefreshResult,
} from './useAgentSessionLifecycle'
import { useAgentSessionActionsController } from './useAgentSessionActionsController'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type Hook = ReturnType<typeof useAgentSessionLifecycle>

function session(id: string, title = `会话 ${id}`): AgentSession {
  return {
    id,
    projectId: 'p1',
    title,
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function input(
  patch: Partial<AgentSessionLifecycleInput> = {},
): AgentSessionLifecycleInput {
  return {
    track: <T,>(work: () => Promise<T>) => work(),
    controllerRefresh: async () => [],
    sessionsGet: async () => null,
    sessionsMessagesFor: async () => [],
    sessionsUpdateFields: async () => null,
    sessionsRename: async () => undefined,
    sessionsRemove: async () => undefined,
    onSwitched: vi.fn(),
    ...patch,
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

describe('useAgentSessionLifecycle', () => {
  it('refresh 只更新列表，不改变当前选择', async () => {
    const viewRef: { current: Hook | null } = { current: null }
    let rows = [session('s1'), session('s2')]
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          controllerRefresh: async () => rows,
          sessionsGet: async (id) =>
            [session('s1'), session('s2')].find((item) => item.id === id) ??
            null,
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    await act(async () => {
      await viewRef.current!.switchTo(session('s1'))
    })
    expect(viewRef.current!.current?.id).toBe('s1')

    let result!: AgentSessionRefreshResult
    await act(async () => {
      result = await viewRef.current!.refresh()
    })
    expect(result.applied).toBe(true)
    expect(result.rows).toHaveLength(2)
    expect(viewRef.current!.list).toHaveLength(2)
    expect(viewRef.current!.current?.id).toBe('s1')

    rows = [session('s2')]
    await act(async () => {
      await viewRef.current!.refresh()
    })
    expect(viewRef.current!.list).toHaveLength(1)
    expect(viewRef.current!.current?.id).toBe('s1')
  })

  it('refresh 异常时保留旧列表，不伪造空列表', async () => {
    const viewRef: { current: Hook | null } = { current: null }
    let shouldFail = false
    const rows = [session('s1')]
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          controllerRefresh: async () => {
            if (shouldFail) throw new Error('refresh failed')
            return rows
          },
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    await act(async () => {
      await viewRef.current!.refresh()
    })
    expect(viewRef.current!.list).toHaveLength(1)

    shouldFail = true
    await expect(
      act(async () => {
        await viewRef.current!.refresh()
      }),
    ).rejects.toThrow('refresh failed')
    expect(viewRef.current!.list).toHaveLength(1)
  })

  it('初始加载 refresh 乱序时 stale rows 不可应用', async () => {
    const first = deferred<AgentSession[]>()
    const second = deferred<AgentSession[]>()
    const controllerRefresh = vi
      .fn<() => Promise<AgentSession[]>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({ controllerRefresh }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    let firstRefresh!: Promise<AgentSessionRefreshResult>
    let secondRefresh!: Promise<AgentSessionRefreshResult>
    act(() => {
      firstRefresh = viewRef.current!.refresh()
      secondRefresh = viewRef.current!.refresh()
    })
    await act(async () => {
      second.resolve([session('s2')])
      expect((await secondRefresh).applied).toBe(true)
    })
    expect(viewRef.current!.list.map((item) => item.id)).toEqual(['s2'])

    let staleResult!: AgentSessionRefreshResult
    await act(async () => {
      first.resolve([session('s1'), session('s2')])
      staleResult = await firstRefresh
    })
    expect(staleResult.applied).toBe(false)
    expect(staleResult.rows.map((item) => item.id)).toEqual(['s1', 's2'])
    expect(viewRef.current!.list.map((item) => item.id)).toEqual(['s2'])
  })

  it('删除前旧 refresh 晚返回不能恢复已删会话', async () => {
    const deleted = session('s1')
    const staleRefresh = deferred<AgentSession[]>()
    const controllerRefresh = vi
      .fn<() => Promise<AgentSession[]>>()
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockImplementationOnce(async () => {
        throw new Error('post-delete refresh failed')
      })
    const notify = vi.fn()
    const lifecycleRef: { current: Hook | null } = { current: null }
    const actionsRef: {
      current: ReturnType<typeof useAgentSessionActionsController> | null
    } = { current: null }
    const track = <T,>(work: () => Promise<T>) => work()

    function Probe() {
      const lifecycle = useAgentSessionLifecycle(
        input({
          controllerRefresh,
          track,
          onSwitched: vi.fn(),
        }),
      )
      lifecycleRef.current = lifecycle
      actionsRef.current = useAgentSessionActionsController({
        current: lifecycle.current,
        projectId: 'p1',
        chatModelOptions: ['GPT-6 Astra'],
        imageModelOptions: [],
        videoModelOptions: [],
        trackRun: track,
        createSession: async () => session('new-session'),
        loadAgentDefault: async () => null,
        logicalModelOf: (model) => model,
        defaultModelFor: (options) => options[0] ?? '',
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
        notify,
      })
      return null
    }

    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    act(() => {
      lifecycleRef.current!.setList([deleted])
      lifecycleRef.current!.setCurrent(deleted)
    })

    let staleRefreshPromise!: Promise<AgentSessionRefreshResult>
    act(() => {
      staleRefreshPromise = lifecycleRef.current!.refresh()
    })
    expect(controllerRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await actionsRef.current!.deleteSession()
    })
    await act(async () => {
      await actionsRef.current!.deleteSession()
    })
    expect(lifecycleRef.current!.list).toHaveLength(0)
    expect(lifecycleRef.current!.current).toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)

    await act(async () => {
      staleRefresh.resolve([deleted, session('s2')])
      expect((await staleRefreshPromise).applied).toBe(false)
    })
    expect(lifecycleRef.current!.list).toHaveLength(0)
    expect(lifecycleRef.current!.current).toBeNull()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('rename A/B 交错时 stale refresh 不覆盖 B 的列表和 current', async () => {
    const first = session('s1', 'A-old')
    const second = session('s2', 'B-old')
    const staleRowsRefresh = deferred<AgentSession[]>()
    const secondRows = [
      session('s1', 'A-old'),
      session('s2', 'B-new'),
    ]
    const controllerRefresh = vi
      .fn<() => Promise<AgentSession[]>>()
      .mockImplementationOnce(() => staleRowsRefresh.promise)
      .mockImplementationOnce(async () => secondRows)
    const lifecycleRef: { current: Hook | null } = { current: null }
    const actionsRef: {
      current: ReturnType<typeof useAgentSessionActionsController> | null
    } = { current: null }
    const track = <T,>(work: () => Promise<T>) => work()

    function Probe() {
      const lifecycle = useAgentSessionLifecycle(
        input({
          controllerRefresh,
          track,
          sessionsGet: async (id) =>
            id === first.id ? first : id === second.id ? second : null,
        }),
      )
      lifecycleRef.current = lifecycle
      actionsRef.current = useAgentSessionActionsController({
        current: lifecycle.current,
        projectId: 'p1',
        chatModelOptions: ['GPT-6 Astra'],
        imageModelOptions: [],
        videoModelOptions: [],
        trackRun: track,
        createSession: async () => session('new-session'),
        loadAgentDefault: async () => null,
        logicalModelOf: (model) => model,
        defaultModelFor: (options) => options[0] ?? '',
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
      return null
    }

    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    act(() => {
      lifecycleRef.current!.setList([first, second])
      lifecycleRef.current!.setCurrent(first)
    })

    act(() => actionsRef.current!.startRename())
    act(() => actionsRef.current!.setTitleDraft('A-new'))
    let firstCommit!: Promise<void>
    act(() => {
      firstCommit = actionsRef.current!.commitRename()
    })
    await vi.waitFor(() => {
      expect(controllerRefresh).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await lifecycleRef.current!.switchTo(second)
    })
    act(() => actionsRef.current!.startRename())
    act(() => actionsRef.current!.setTitleDraft('B-new'))
    await act(async () => {
      await actionsRef.current!.commitRename()
    })
    expect(lifecycleRef.current!.list.map((item) => item.title)).toEqual([
      'A-old',
      'B-new',
    ])
    expect(lifecycleRef.current!.current?.title).toBe('B-new')

    await act(async () => {
      staleRowsRefresh.resolve([
        session('s1', 'A-new'),
        second,
      ])
      await firstCommit
    })
    expect(lifecycleRef.current!.list.map((item) => item.title)).toEqual([
      'A-old',
      'B-new',
    ])
    expect(lifecycleRef.current!.current?.id).toBe('s2')
    expect(lifecycleRef.current!.current?.title).toBe('B-new')
  })

  it('switchTo 读取完整消息并更新 current，onSwitched 只调一次', async () => {
    const onSwitched = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    const target = session('s2')
    const messages: ChatMessage[] = [
      { role: 'user', content: 'hi', createdAt: 1 },
    ]
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          sessionsGet: async (id) => (id === 's2' ? target : null),
          sessionsMessagesFor: async (id) => (id === 's2' ? messages : []),
          onSwitched,
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    await act(async () => {
      await viewRef.current!.switchTo(target)
    })
    expect(viewRef.current!.current?.id).toBe('s2')
    expect(viewRef.current!.messages).toHaveLength(1)
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(onSwitched).toHaveBeenCalledWith(target)
  })

  it('后到的旧 switchTo 不会覆盖新选择', async () => {
    const onSwitched = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    const first = session('s1')
    const second = session('s2')
    let resolveFirst!: () => void
    const firstGet = new Promise<AgentSession | null>((resolve) => {
      resolveFirst = () => resolve(first)
    })
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          sessionsGet: (id) =>
            id === 's1' ? firstGet : Promise.resolve(second),
          onSwitched,
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    const firstSwitch = viewRef.current!.switchTo(first)
    const secondSwitch = viewRef.current!.switchTo(second)
    await act(async () => {
      await secondSwitch
    })
    expect(viewRef.current!.current?.id).toBe('s2')
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(onSwitched).toHaveBeenCalledWith(second)

    await act(async () => {
      resolveFirst()
      await firstSwitch
    })
    expect(viewRef.current!.current?.id).toBe('s2')
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(onSwitched).toHaveBeenCalledWith(second)
  })

  it('switchTo 等待期间目标被 remove 后不得写回', async () => {
    const first = session('s1')
    const second = session('s2')
    const loaded = deferred<AgentSession | null>()
    const loadedMessages = deferred<ChatMessage[]>()
    const sessionsGet = vi.fn(() => loaded.promise)
    const onSwitched = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          sessionsGet,
          sessionsMessagesFor: () => loadedMessages.promise,
          sessionsRemove: async () => undefined,
          onSwitched,
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    act(() => {
      viewRef.current!.setList([first, second])
    })

    let switching!: Promise<void>
    act(() => {
      switching = viewRef.current!.switchTo(first)
    })
    await vi.waitFor(() => {
      expect(sessionsGet).toHaveBeenCalledWith('s1')
    })
    await act(async () => {
      await viewRef.current!.removeSession('s1')
    })
    expect(viewRef.current!.list.map((item) => item.id)).toEqual(['s2'])

    await act(async () => {
      loaded.resolve(first)
      loadedMessages.resolve([
        { role: 'assistant', content: 'stale', createdAt: 1 },
      ])
      await switching
    })
    expect(viewRef.current!.current).toBeNull()
    expect(viewRef.current!.currentIdRef.current).toBeNull()
    expect(viewRef.current!.messages).toHaveLength(0)
    expect(onSwitched).not.toHaveBeenCalled()
    expect(viewRef.current!.list.map((item) => item.id)).toEqual(['s2'])
  })

  it('remove 失败时等待中的 switchTo 仍可正常完成', async () => {
    const first = session('s1')
    const second = session('s2')
    const loaded = deferred<AgentSession | null>()
    const loadedMessages = deferred<ChatMessage[]>()
    const sessionsGet = vi.fn(() => loaded.promise)
    const onSwitched = vi.fn()
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          sessionsGet,
          sessionsMessagesFor: () => loadedMessages.promise,
          sessionsRemove: async () => {
            throw new Error('remove failed')
          },
          onSwitched,
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    act(() => {
      viewRef.current!.setList([first, second])
    })

    let switching!: Promise<void>
    act(() => {
      switching = viewRef.current!.switchTo(first)
    })
    await vi.waitFor(() => {
      expect(sessionsGet).toHaveBeenCalledWith('s1')
    })
    await expect(
      act(async () => {
        await viewRef.current!.removeSession('s1')
      }),
    ).rejects.toThrow('remove failed')

    await act(async () => {
      loaded.resolve(first)
      loadedMessages.resolve([
        { role: 'assistant', content: 'current', createdAt: 1 },
      ])
      await switching
    })
    expect(viewRef.current!.current?.id).toBe('s1')
    expect(viewRef.current!.currentIdRef.current).toBe('s1')
    expect(viewRef.current!.messages).toHaveLength(1)
    expect(onSwitched).toHaveBeenCalledTimes(1)
    expect(onSwitched).toHaveBeenCalledWith(first)
    expect(viewRef.current!.list.map((item) => item.id)).toEqual([
      's1',
      's2',
    ])
  })

  it('applySessionSnapshot 只更新目标行，非当前不改 current', async () => {
    const viewRef: { current: Hook | null } = { current: null }
    const rows = [session('s1'), session('s2')]
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          controllerRefresh: async () => rows,
          sessionsGet: async () => session('s2'),
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    await act(async () => {
      await viewRef.current!.refresh()
    })
    await act(async () => {
      await viewRef.current!.switchTo(session('s2'))
    })
    expect(viewRef.current!.current?.id).toBe('s2')

    act(() => {
      viewRef.current!.applySessionSnapshot(session('s1'))
    })
    expect(viewRef.current!.list).toHaveLength(2)
    expect(viewRef.current!.current?.id).toBe('s2')

    const updated = { ...session('s2'), title: '改名' }
    act(() => {
      viewRef.current!.applySessionSnapshot(updated)
    })
    expect(viewRef.current!.list[1]!.title).toBe('改名')
    expect(viewRef.current!.current?.title).toBe('改名')
  })

  it('rename / remove / patch 端口调用正确，失败不伪造成功', async () => {
    const updateFields = vi.fn(async () => null)
    const rename = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          sessionsUpdateFields: updateFields,
          sessionsRename: rename,
          sessionsRemove: remove,
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    let result!: AgentSession | null
    await act(async () => {
      result = await viewRef.current!.patchSession('s1', { title: '新名' })
    })
    expect(updateFields).toHaveBeenCalledWith('s1', { title: '新名' })
    expect(result).toBeNull()

    await act(async () => {
      await viewRef.current!.removeSession('s1')
    })
    expect(remove).toHaveBeenCalledWith('s1')

    await act(async () => {
      await viewRef.current!.renameSession('s1', '新标题')
    })
    expect(rename).toHaveBeenCalledWith('s1', '新标题')
  })

  it('remove 成功后过滤 setList、refresh 与 switchTo', async () => {
    const first = session('s1')
    const second = session('s2')
    const onSwitched = vi.fn()
    const sessionsRemove = vi.fn(async () => undefined)
    const sessionsGet = vi.fn(async () => first)
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          controllerRefresh: async () => [first, second],
          sessionsGet,
          sessionsRemove,
          onSwitched,
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    act(() => {
      viewRef.current!.setList([first, second])
      viewRef.current!.setCurrent(second)
    })

    await act(async () => {
      await viewRef.current!.removeSession(first.id)
    })
    expect(viewRef.current!.list.map((item) => item.id)).toEqual(['s2'])

    let refreshed!: AgentSessionRefreshResult
    await act(async () => {
      refreshed = await viewRef.current!.refresh()
    })
    expect(refreshed.rows.map((item) => item.id)).toEqual(['s2'])
    expect(viewRef.current!.list.map((item) => item.id)).toEqual(['s2'])

    act(() => {
      viewRef.current!.setList([first, second])
    })
    expect(viewRef.current!.list.map((item) => item.id)).toEqual(['s2'])

    await act(async () => {
      await viewRef.current!.switchTo(first)
    })
    expect(sessionsGet).not.toHaveBeenCalled()
    expect(onSwitched).not.toHaveBeenCalled()
    expect(viewRef.current!.current?.id).toBe('s2')
  })

  it('remove 失败不写 discard tombstone，也不过滤列表', async () => {
    const first = session('s1')
    const second = session('s2')
    const viewRef: { current: Hook | null } = { current: null }
    function Probe() {
      viewRef.current = useAgentSessionLifecycle(
        input({
          controllerRefresh: async () => [first, second],
          sessionsRemove: async () => {
            throw new Error('remove failed')
          },
        }),
      )
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    act(() => {
      viewRef.current!.setList([first, second])
    })

    await expect(
      act(async () => {
        await viewRef.current!.removeSession(first.id)
      }),
    ).rejects.toThrow('remove failed')
    expect(viewRef.current!.list.map((item) => item.id)).toEqual([
      's1',
      's2',
    ])

    let refreshed!: AgentSessionRefreshResult
    await act(async () => {
      refreshed = await viewRef.current!.refresh()
    })
    expect(refreshed.rows.map((item) => item.id)).toEqual(['s1', 's2'])
    expect(viewRef.current!.list.map((item) => item.id)).toEqual([
      's1',
      's2',
    ])
  })
})
