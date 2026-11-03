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
    defaultModelFor: (options, saved) =>
      saved && options.includes(saved) ? saved : (options[0] ?? ''),
    selectedModelOf: vi.fn((kind) =>
      kind === 'image' ? 'Selected Image' : 'Selected Video',
    ),
    refresh: vi.fn(async () => [session('s1')]),
    switchTo: vi.fn(async () => undefined),
    setCurrent: vi.fn(),
    renameSession: vi.fn(async () => undefined),
    removeSession: vi.fn(async () => undefined),
    clearDraftForSession: vi.fn(),
    clearSessionRuntime: vi.fn(),
    isDeleteBlocked: vi.fn(() => false),
    notify: vi.fn(),
    ...patch,
  }
}

function render(props: AgentSessionActionsControllerInput): {
  viewRef: { current: Hook | null }
  renderer: TestRenderer.ReactTestRenderer
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe() {
    viewRef.current = useAgentSessionActionsController(props)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe))
  })
  return { viewRef, renderer }
}

describe('useAgentSessionActionsController', () => {
  it('新建会话复用默认模型和选中素材模型，最后只走 switchTo', async () => {
    const created = session('new-session')
    const createSession = vi.fn(async () => created)
    const refresh = vi.fn(async () => [created])
    const switchTo = vi.fn(async () => undefined)
    const setCurrent = vi.fn()
    const props = input({
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

  it('改名只合并仍为当前目标的行，用户已切换时不强行切回', async () => {
    const target = session('s1', '旧标题')
    const other = session('s2', '另一个会话')
    const setCurrent = vi.fn()
    const refresh = vi.fn(async () => [
      session('s1', '新标题'),
      other,
    ])
    const props = input({
      current: target,
      refresh,
      setCurrent,
    })
    const { viewRef } = render(props)

    act(() => {
      viewRef.current!.startRename()
    })
    expect(viewRef.current?.renaming).toBe(true)
    expect(viewRef.current?.titleDraft).toBe('旧标题')
    act(() => {
      viewRef.current!.setTitleDraft('新标题')
    })
    await act(async () => {
      await viewRef.current!.commitRename()
    })

    expect(props.renameSession).toHaveBeenCalledWith('s1', '新标题')
    const updater = setCurrent.mock.calls[0]![0] as (
      previous: AgentSession | null,
    ) => AgentSession | null
    expect(updater(other)).toBe(other)
    expect(updater(target)).toMatchObject({
      id: 's1',
      title: '新标题',
      messages: target.messages,
    })
    expect(viewRef.current?.renaming).toBe(false)
  })

  it('删除先进入确认态，第二次才删除并切到剩余会话', async () => {
    const current = session('s1')
    const next = session('s2')
    const removeSession = vi.fn(async () => undefined)
    const refresh = vi.fn(async () => [next])
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
      refresh: vi.fn(async () => []),
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
