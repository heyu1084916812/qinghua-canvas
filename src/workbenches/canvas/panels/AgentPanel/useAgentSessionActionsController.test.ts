import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  useAgentSessionActionsController,
  type AgentSessionActionsControllerInput,
} from './useAgentSessionActionsController'

type Hook = ReturnType<typeof useAgentSessionActionsController>

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

function refreshResult(
  rows: readonly AgentSession[],
  applied = true,
) {
  return { rows, applied }
}

function input(
  patch: Partial<AgentSessionActionsControllerInput> = {},
): AgentSessionActionsControllerInput {
  return {
    current: session('s1'),
    projectId: 'p1',
    chatModelOptions: ['GPT-6 Astra', 'Saved Chat'],
    imageModelOptions: ['GPT Image 2'],
    videoModelOptions: ['Veo 3'],
    trackRun: <T,>(work: () => Promise<T>) => work(),
    createSession: vi.fn(async (value) => ({
      ...session('new-session'),
      ...value,
    })),
    loadAgentDefault: vi.fn(async () => ({ model: 'Saved Chat' })),
    logicalModelOf: vi.fn((model) => model),
    defaultModelFor: (options, preferred) => {
      const list = typeof preferred === 'string' ? [preferred] : (preferred ?? [])
      return list.find((model) => model && options.includes(model)) ?? options[0] ?? ''
    },
    selectedModelOf: vi.fn((kind) =>
      kind === 'image' ? 'Selected Image' : 'Selected Video',
    ),
    refresh: vi.fn(async () => refreshResult([session('s1')])),
    switchTo: vi.fn(async () => undefined),
    setCurrent: vi.fn(),
    clearInvalidCurrent: vi.fn(),
    renameSession: vi.fn(async () => undefined),
    removeSession: vi.fn(async () => undefined),
    clearDraftForSession: vi.fn(),
    clearSessionRuntime: vi.fn(),
    isCurrentSession: vi.fn(() => true),
    isDeleteBlocked: vi.fn(() => false),
    describeError: (error) =>
      error instanceof Error ? error.message : String(error),
    notify: vi.fn(),
    ...patch,
  }
}

function render(props: AgentSessionActionsControllerInput): {
  viewRef: { current: Hook | null }
  renderer: TestRenderer.ReactTestRenderer
  update: (next: AgentSessionActionsControllerInput) => void
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe(next: AgentSessionActionsControllerInput) {
    viewRef.current = useAgentSessionActionsController(next)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe, props))
  })
  return {
    viewRef,
    renderer,
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

describe('useAgentSessionActionsController', () => {
  it('新建会话复用默认模型和选中素材模型，最后只走 switchTo', async () => {
    const created = session('new-session')
    const createSession = vi.fn(async () => created)
    const refresh = vi.fn(async () => refreshResult([created]))
    const switchTo = vi.fn(async () => undefined)
    const setCurrent = vi.fn()
    const props = input({
      /* 当前会话的模型不在清单里 ⇒ 落到保存的默认 */
      current: { ...session('s1'), model: 'Retired Chat' },
      createSession,
      refresh,
      switchTo,
      setCurrent,
    })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.newSession()
    })

    expect(createSession).toHaveBeenCalledWith({
      projectId: 'p1',
      channelId: '',
      model: 'Saved Chat',
      imageModel: 'Selected Image',
      videoModel: 'Selected Video',
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(switchTo).toHaveBeenCalledWith(created)
    expect(setCurrent).not.toHaveBeenCalled()
  })

  it('改名晚返回时，用户已切换则不再改 current', async () => {
    const target = session('s1', '旧标题')
    const other = session('s2', '另一个会话')
    const renamed = session('s1', '新标题')
    const rename = deferred<void>()
    const setCurrent = vi.fn()
    const refresh = vi.fn(async () => refreshResult([renamed, other]))
    let currentId = target.id
    const props = input({
      current: target,
      renameSession: vi.fn(() => rename.promise),
      refresh,
      setCurrent,
      isCurrentSession: (sessionId) => currentId === sessionId,
    })
    const { viewRef, update } = render(props)

    act(() => {
      viewRef.current!.startRename()
    })
    expect(viewRef.current?.renaming).toBe(true)
    expect(viewRef.current?.titleDraft).toBe('旧标题')
    act(() => {
      viewRef.current!.setTitleDraft('新标题')
    })
    let committing!: Promise<void>
    act(() => {
      committing = viewRef.current!.commitRename()
    })

    expect(props.renameSession).toHaveBeenCalledWith('s1', '新标题')
    currentId = other.id
    update({ ...props, current: other })
    await act(async () => {
      rename.resolve()
      await committing
    })

    expect(setCurrent).not.toHaveBeenCalled()
    expect(viewRef.current?.renaming).toBe(false)
  })

  it('改名晚返回且仍为当前时合并目标行并保留消息', async () => {
    const target = session('s1', '旧标题')
    const other = session('s2')
    const renamed = session('s1', '新标题')
    const rename = deferred<void>()
    let currentState: AgentSession | null = target
    const setCurrent = vi.fn(
      (value: AgentSession | null | ((previous: AgentSession | null) => AgentSession | null)) => {
        currentState =
          typeof value === 'function' ? value(currentState) : value
      },
    )
    const props = input({
      current: target,
      renameSession: vi.fn(() => rename.promise),
      refresh: vi.fn(async () => refreshResult([renamed, other])),
      setCurrent,
      isCurrentSession: (sessionId) => currentState?.id === sessionId,
    })
    const { viewRef } = render(props)

    act(() => viewRef.current!.startRename())
    act(() => viewRef.current!.setTitleDraft('新标题'))
    let committing!: Promise<void>
    act(() => {
      committing = viewRef.current!.commitRename()
    })
    await act(async () => {
      rename.resolve()
      await committing
    })

    expect(setCurrent).toHaveBeenCalledTimes(1)
    expect(currentState).toMatchObject({
      id: 's1',
      title: '新标题',
      messages: target.messages,
    })
  })

  it('删除先进入确认态，第二次才删除并切到剩余会话', async () => {
    const current = session('s1')
    const next = session('s2')
    const removeSession = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => refreshResult([next]))
    const switchTo = vi.fn(async () => undefined)
    const clearDraftForSession = vi.fn()
    const clearSessionRuntime = vi.fn()
    const props = input({
      current,
      removeSession,
      refresh,
      switchTo,
      clearDraftForSession,
      clearSessionRuntime,
    })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    expect(viewRef.current?.confirmDelete).toBe(true)
    expect(removeSession).not.toHaveBeenCalled()

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    expect(removeSession).toHaveBeenCalledWith('s1')
    expect(clearDraftForSession).toHaveBeenCalledWith('s1')
    expect(clearSessionRuntime).toHaveBeenCalledWith('s1')
    expect(switchTo).toHaveBeenCalledWith(next)
  })

  it('删除完成时用户已切到 s3，不再自动切回 s2', async () => {
    const current = session('s1')
    const s2 = session('s2')
    const s3 = session('s3')
    const remove = deferred<void>()
    let currentId: string | null = current.id
    const removeSession = vi.fn(() => remove.promise)
    const switchTo = vi.fn(async () => undefined)
    const clearDraftForSession = vi.fn()
    const clearSessionRuntime = vi.fn()
    const createSession = vi.fn(async () => session('unused'))
    const props = input({
      current,
      removeSession,
      refresh: vi.fn(async () => refreshResult([s2, s3])),
      switchTo,
      clearDraftForSession,
      clearSessionRuntime,
      createSession,
      isCurrentSession: (sessionId) => currentId === sessionId,
    })
    const { viewRef, update } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    let deleting!: Promise<void>
    act(() => {
      deleting = viewRef.current!.deleteSession()
    })
    expect(removeSession).toHaveBeenCalledWith('s1')

    currentId = s3.id
    act(() => viewRef.current!.resetForSessionSwitch())
    update({ ...props, current: s3 })
    await act(async () => {
      remove.resolve()
      await deleting
    })

    expect(clearDraftForSession).toHaveBeenCalledWith('s1')
    expect(clearSessionRuntime).toHaveBeenCalledWith('s1')
    expect(switchTo).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
    expect(viewRef.current?.confirmDelete).toBe(false)
  })

  it('删除成功后刷新列表失败，清失效选择且只提示一次', async () => {
    const clearInvalidCurrent = vi.fn()
    const notify = vi.fn()
    const switchTo = vi.fn(async () => undefined)
    const props = input({
      refresh: vi.fn(async () => {
        throw new Error('refresh failed')
      }),
      clearInvalidCurrent,
      switchTo,
      notify,
    })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    await act(async () => {
      await expect(viewRef.current!.deleteSession()).resolves.toBeUndefined()
    })

    expect(clearInvalidCurrent).toHaveBeenCalledTimes(1)
    expect(clearInvalidCurrent).toHaveBeenCalledWith('s1')
    expect(switchTo).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      '会话已删除，但刷新会话列表失败：refresh failed',
      'error',
    )
  })

  it('删除后 refresh 为 stale 时不使用旧 rows 自动切会话', async () => {
    const clearInvalidCurrent = vi.fn()
    const switchTo = vi.fn(async () => undefined)
    const notify = vi.fn()
    const props = input({
      refresh: vi.fn(async () =>
        refreshResult([session('s2')], false),
      ),
      clearInvalidCurrent,
      switchTo,
      notify,
    })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    await act(async () => {
      await expect(viewRef.current!.deleteSession()).resolves.toBeUndefined()
    })

    expect(clearInvalidCurrent).toHaveBeenCalledTimes(1)
    expect(switchTo).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('删除成功后自动切换失败，清失效选择且只提示一次', async () => {
    const clearInvalidCurrent = vi.fn()
    const notify = vi.fn()
    const switchTo = vi.fn(async () => {
      throw new Error('switch failed')
    })
    const props = input({
      refresh: vi.fn(async () => refreshResult([session('s2')])),
      switchTo,
      clearInvalidCurrent,
      notify,
    })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    await act(async () => {
      await expect(viewRef.current!.deleteSession()).resolves.toBeUndefined()
    })

    expect(clearInvalidCurrent).toHaveBeenCalledTimes(1)
    expect(clearInvalidCurrent).toHaveBeenCalledWith('s1')
    expect(switchTo).toHaveBeenCalledWith(session('s2'))
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      '会话已删除，但自动切换会话失败，请手动选择会话：switch failed',
      'error',
    )
  })

  it('自动切换期间用户已切到 s3，切换失败不清 s3', async () => {
    const current = session('s1')
    const s2 = session('s2')
    const s3 = session('s3')
    const switching = deferred<void>()
    let currentId: string | null = current.id
    const clearInvalidCurrent = vi.fn((sessionId) => {
      if (currentId === sessionId) currentId = null
    })
    const notify = vi.fn()
    const props = input({
      current,
      refresh: vi.fn(async () => refreshResult([s2])),
      switchTo: vi.fn(() => switching.promise),
      clearInvalidCurrent,
      notify,
      isCurrentSession: (sessionId) => currentId === sessionId,
    })
    const { viewRef, update } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    let deleting!: Promise<void>
    act(() => {
      deleting = viewRef.current!.deleteSession()
    })
    await vi.waitFor(() => {
      expect(props.switchTo).toHaveBeenCalledWith(s2)
    })

    currentId = s3.id
    update({ ...props, current: s3 })
    await act(async () => {
      switching.reject(new Error('switch failed'))
      await deleting
    })

    expect(currentId).toBe('s3')
    expect(clearInvalidCurrent).toHaveBeenCalledTimes(1)
    expect(clearInvalidCurrent).toHaveBeenCalledWith('s1')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      '会话已删除，但自动切换会话失败，请手动选择会话：switch failed',
      'error',
    )
  })

  it('删除失败时不提前清草稿或运行态', async () => {
    const remove = deferred<void>()
    const clearDraftForSession = vi.fn()
    const clearSessionRuntime = vi.fn()
    const switchTo = vi.fn(async () => undefined)
    const props = input({
      removeSession: vi.fn(() => remove.promise),
      clearDraftForSession,
      clearSessionRuntime,
      switchTo,
    })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    let deleting!: Promise<void>
    act(() => {
      deleting = viewRef.current!.deleteSession()
    })
    await act(async () => {
      remove.reject(new Error('delete failed'))
      await expect(deleting).rejects.toThrow('delete failed')
    })

    expect(clearDraftForSession).not.toHaveBeenCalled()
    expect(clearSessionRuntime).not.toHaveBeenCalled()
    expect(switchTo).not.toHaveBeenCalled()
  })

  it('最后会话删除后自动新建失败时清失效选择并提示删除已完成', async () => {
    const current = session('s1')
    const clearInvalidCurrent = vi.fn()
    const notify = vi.fn()
    const switchTo = vi.fn(async () => undefined)
    const props = input({
      current,
      refresh: vi.fn(async () => refreshResult([])),
      createSession: vi.fn(async () => {
        throw new Error('create failed')
      }),
      clearInvalidCurrent,
      switchTo,
      notify,
    })
    const { viewRef } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    await act(async () => {
      await viewRef.current!.deleteSession()
    })

    expect(clearInvalidCurrent).toHaveBeenCalledWith('s1')
    expect(switchTo).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      '会话已删除，但自动新建会话失败，请手动新建会话：create failed',
      'error',
    )
    expect(clearInvalidCurrent).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('会话仍有活动时拒绝删除；无剩余会话时新建兜底', async () => {
    const current = session('s1')
    const created = session('new-session')
    const isDeleteBlocked = vi.fn(() => true)
    const notify = vi.fn()
    const props = input({
      current,
      isDeleteBlocked,
      notify,
    })
    const { viewRef, renderer } = render(props)

    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    await act(async () => {
      await viewRef.current!.deleteSession()
    })
    expect(props.removeSession).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      '当前会话还有任务在运行，请先停止后再删除',
      'error',
    )
    act(() => renderer.unmount())

    const removeSession = vi.fn(async () => undefined)
    const switchTo = vi.fn(async () => undefined)
    const nextProps = input({
      current,
      removeSession,
      refresh: vi.fn(async () => refreshResult([])),
      switchTo,
      createSession: vi.fn(async () => created),
    })
    const second = render(nextProps)
    await act(async () => {
      await second.viewRef.current!.deleteSession()
    })
    await act(async () => {
      await second.viewRef.current!.deleteSession()
    })
    expect(removeSession).toHaveBeenCalledWith('s1')
    expect(switchTo).toHaveBeenCalledWith(created)
  })

  it('会话切换 reset 只清编辑态', () => {
    const { viewRef } = render(input())
    act(() => viewRef.current!.startRename())
    expect(viewRef.current?.renaming).toBe(true)

    act(() => viewRef.current!.resetForSessionSwitch())
    expect(viewRef.current?.renaming).toBe(false)
    expect(viewRef.current?.confirmDelete).toBe(false)
  })
})

describe('useAgentSessionActionsController · 新会话的对话模型（A4）', () => {
  it('★ 新会话优先沿用当前会话的对话模型，其次才是保存的默认', async () => {
    const createSession = vi.fn(async (value) => ({ ...session('n'), ...value }))
    const defaultModelFor = vi.fn(
      (options: readonly string[], preferred?: string | readonly string[]) => {
        const list = typeof preferred === 'string' ? [preferred] : (preferred ?? [])
        return list.find((m) => m && options.includes(m)) ?? options[0] ?? ''
      },
    )
    const current = { ...session('s1'), model: 'Deepseek 4.1 Flash' }
    const { viewRef } = render(
      input({
        current,
        chatModelOptions: ['Agnes 2.5 Flash', 'Saved Chat', 'Deepseek 4.1 Flash'],
        createSession,
        defaultModelFor,
      }),
    )
    await act(async () => {
      await viewRef.current!.newSession()
    })
    expect(defaultModelFor).toHaveBeenCalledWith(
      ['Agnes 2.5 Flash', 'Saved Chat', 'Deepseek 4.1 Flash'],
      ['Deepseek 4.1 Flash', 'Saved Chat'],
    )
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'Deepseek 4.1 Flash' }),
    )
  })
})
