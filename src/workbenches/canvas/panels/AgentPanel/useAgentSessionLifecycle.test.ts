import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  useAgentSessionLifecycle,
  type AgentSessionLifecycleInput,
} from './useAgentSessionLifecycle'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

type Hook = ReturnType<typeof useAgentSessionLifecycle>

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

    let result!: readonly AgentSession[]
    await act(async () => {
      result = await viewRef.current!.refresh()
    })
    expect(result).toHaveLength(2)
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
})
