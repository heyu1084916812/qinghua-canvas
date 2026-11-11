import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../../../domain/project/channel'
import { panelModelOptions } from '../../../../domain/project/modelCatalog'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  useAgentModelSelectionController,
  type AgentModelSelectionControllerInput,
} from './useAgentModelSelectionController'

type Hook = ReturnType<typeof useAgentModelSelectionController>

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function session(id: string, model: string): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model,
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function channel(
  id = 'channel-1',
  imageModels = ['Image A', 'Image U'],
  videoModels = ['Video A', 'Video U'],
): Channel {
  return {
    id,
    priority: 1,
    models: [
      ...imageModels.map((model) => ({
        id: model,
        category: 'image' as const,
        inputTypes: ['text' as const],
      })),
      ...videoModels.map((model) => ({
        id: model,
        category: 'video' as const,
        inputTypes: ['text' as const],
      })),
    ],
    modelCache: [],
    modelMap: Object.fromEntries([
      ...imageModels.map((model) => [
        model,
        model === 'Image A' ? 'up-image-a' : `up-${model}`,
      ]),
      ...videoModels.map((model) => [
        model,
        model === 'Video A' ? 'up-video-a' : `up-${model}`,
      ]),
    ]),
  } as unknown as Channel
}

function createChannelsStore(initial: {
  channels?: Channel[]
  customModels?: string[]
  uncommonModelIds?: string[]
}) {
  let state = {
    channels: initial.channels ?? [channel()],
    customModels: initial.customModels ?? [],
    uncommonModelIds: initial.uncommonModelIds ?? [],
  }
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getState: () => state,
    globalModelsOf: vi.fn((category: 'image' | 'video') => {
      const base = state.channels.flatMap((item) =>
        item.models
          .filter((model) => model.category === category)
          .map((model) => model.id),
      )
      const custom =
        category === 'image' ? state.customModels : []
      return [...base, ...custom]
        .filter((id) => !state.uncommonModelIds.includes(id))
        .map((id) => ({ id }))
    }),
    update(next: Partial<typeof state>) {
      state = { ...state, ...next }
      for (const listener of listeners) listener()
    },
  }
}

function input(
  patch: Partial<AgentModelSelectionControllerInput> = {},
): AgentModelSelectionControllerInput {
  return {
    current: session('s1', 'Image A'),
    draft: '',
    channels: createChannelsStore({}) as never,
    allChannels: [channel()],
    selection: [],
    getCanvasNodes: () => [],
    patchSession: vi.fn(async (sessionId, values) => ({
      ...session(sessionId, 'Image A'),
      ...values,
    })),
    clearChatRoute: vi.fn(),
    rememberStickyModel: vi.fn(),
    ...patch,
  }
}

function render(props: AgentModelSelectionControllerInput): {
  viewRef: { current: Hook | null }
  update: (next: AgentModelSelectionControllerInput) => void
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe(next: AgentModelSelectionControllerInput) {
    viewRef.current = useAgentModelSelectionController(next)
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

describe('useAgentModelSelectionController', () => {
  it('custom/uncommon/channel snapshot 变化刷新清单', () => {
    const channels = createChannelsStore({})
    const props = input({ channels: channels as never })
    const { viewRef, update } = render(props)
    expect(viewRef.current!.globalImageModels).toEqual([
      'Image A',
      'Image U',
    ])
    expect(viewRef.current!.globalVideoModels).toEqual([
      'Video A',
      'Video U',
    ])

    act(() => {
      channels.update({
        customModels: ['Image Custom'],
        uncommonModelIds: ['Image A', 'Video A'],
      })
    })
    expect(viewRef.current!.globalImageModels).toEqual([
      'Image U',
      'Image Custom',
    ])
    expect(viewRef.current!.globalVideoModels).toEqual(['Video U'])
    expect(viewRef.current!.chatModelOptions).toEqual(
      panelModelOptions('chat', ['Image A', 'Video A']),
    )

    const nextChannel = channel(
      'channel-2',
      ['Image B'],
      ['Video B'],
    )
    act(() => {
      channels.update({ channels: [nextChannel] })
    })
    update({ ...props, allChannels: [nextChannel] })
    expect(viewRef.current!.globalImageModels).toEqual([
      'Image B',
      'Image Custom',
    ])
    expect(viewRef.current!.globalVideoModels).toEqual(['Video B'])
  })

  it('老上游 ID 归一为逻辑显示名', () => {
    const target = session('s1', 'up-image-a')
    const { viewRef } = render(input({ current: target }))

    expect(viewRef.current!.logicalModelOf('up-image-a')).toBe(
      'Image A',
    )
    expect(viewRef.current!.shownModel).toBe('Image A')
  })

  it('模型 mention 去重，defaultModelFor 保持回退规则', () => {
    const { viewRef } = render(
      input({
        draft:
          '@[A](model:Image A) @[A2](model:Image A) ' +
          '@[B](model:Video A)',
      }),
    )

    expect([...viewRef.current!.mentionedModels]).toEqual([
      'Image A',
      'Video A',
    ])
    const live = [{ ...channel(), enabled: true } as Channel]
    expect(
      viewRef.current!.defaultModelFor(
        ['Image A', 'Video A'],
        'Video A',
        live,
      ),
    ).toBe('Video A')
    expect(
      viewRef.current!.defaultModelFor(
        ['Image A', 'Video A'],
        'Missing',
        live,
      ),
    ).toBe('Image A')
    /* A4：渠道停用时绝不回落到它提供的模型 */
    const off = [{ ...channel(), enabled: false } as Channel]
    expect(
      viewRef.current!.defaultModelFor(['Image A', 'Video A'], 'Video A', off),
    ).toBe('')
  })

  it('selectedModelOf 按类别读取 Canvas 节点，不过滤未知类别', () => {
    const nodes = [
      { id: 'n1', data: { model: 'Image A' } },
      { id: 'n2', data: { model: 'Video A' } },
      { id: 'n3', data: { model: 'Unknown Model' } },
    ]
    const { viewRef } = render(
      input({
        selection: ['n1', 'n2', 'n3'],
        getCanvasNodes: () => nodes,
      }),
    )

    expect(viewRef.current!.selectedModelOf('image')).toBe('Image A')
    expect(viewRef.current!.selectedModelOf('video')).toBe('Video A')

    const unknownOnly = render(
      input({
        selection: ['n3'],
        getCanvasNodes: () => nodes,
      }),
    )
    expect(unknownOnly.viewRef.current!.selectedModelOf('image')).toBe(
      'Unknown Model',
    )
    expect(unknownOnly.viewRef.current!.selectedModelOf('video')).toBe(
      '',
    )
  })

  it('pickModel 只失效目标 route 并 patch 正确字段', async () => {
    const clearChatRoute = vi.fn()
    const patchSession = vi.fn(async (sessionId: string) => ({
      ...session(sessionId, 'Video A'),
    }))
    const { viewRef } = render(
      input({
        current: session('s1', 'Image A'),
        clearChatRoute,
        patchSession,
      }),
    )

    await act(async () => {
      await viewRef.current!.pickModel('Video A')
    })
    expect(clearChatRoute).toHaveBeenCalledWith('s1')
    expect(clearChatRoute).not.toHaveBeenCalledWith('s2')
    expect(patchSession).toHaveBeenCalledWith('s1', {
      model: 'Video A',
      channelId: '',
    })
  })

  it('快速选择 A/B 时 B 在 A 完成后按序落库', async () => {
    const first = deferred<AgentSession | null>()
    const second = deferred<AgentSession | null>()
    const patchSession = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { viewRef } = render(input({ patchSession }))

    let firstWrite!: Promise<void>
    let secondWrite!: Promise<void>
    act(() => {
      firstWrite = viewRef.current!.pickModel('Image A')
      secondWrite = viewRef.current!.pickModel('Video A')
    })
    await vi.waitFor(() => {
      expect(patchSession).toHaveBeenCalledTimes(1)
    })
    expect(patchSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve(session('s1', 'Image A'))
      await firstWrite
    })
    expect(patchSession).toHaveBeenCalledTimes(2)
    expect(patchSession.mock.calls[1]).toEqual([
      's1',
      { model: 'Video A', channelId: '' },
    ])

    await act(async () => {
      second.resolve(session('s1', 'Video A'))
      await secondWrite
    })
  })

  it('A patch reject 后 B 仍继续执行', async () => {
    const first = deferred<AgentSession | null>()
    const patchSession = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => session('s1', 'Video A'))
    const { viewRef } = render(input({ patchSession }))

    let firstWrite!: Promise<void>
    let secondWrite!: Promise<void>
    act(() => {
      firstWrite = viewRef.current!.pickModel('Image A')
      secondWrite = viewRef.current!.pickModel('Video A')
    })
    await act(async () => {
      first.reject(new Error('first failed'))
      await expect(firstWrite).rejects.toThrow('first failed')
    })
    await act(async () => {
      await secondWrite
    })
    expect(patchSession).toHaveBeenCalledTimes(2)
  })

  it('setModelKind 只有 patch 成功返回后才写 sticky', async () => {
    const patchSession = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(session('s1', 'Image A'))
    const rememberStickyModel = vi.fn()
    const { viewRef } = render(
      input({ patchSession, rememberStickyModel }),
    )

    await act(async () => {
      await viewRef.current!.setModelKind('imageModel', 'Image A')
    })
    expect(rememberStickyModel).not.toHaveBeenCalled()

    await act(async () => {
      await expect(
        viewRef.current!.setModelKind('imageModel', 'Video A'),
      ).rejects.toThrow('write failed')
    })
    expect(rememberStickyModel).not.toHaveBeenCalled()

    await act(async () => {
      await viewRef.current!.setModelKind('videoModel', 'Video A')
    })
    expect(rememberStickyModel).toHaveBeenCalledWith(
      's1',
      'video',
      'Video A',
    )
  })

  it('current 为空时模型动作 no-op', async () => {
    const clearChatRoute = vi.fn()
    const patchSession = vi.fn()
    const rememberStickyModel = vi.fn()
    const { viewRef } = render(
      input({
        current: null,
        clearChatRoute,
        patchSession,
        rememberStickyModel,
      }),
    )

    await act(async () => {
      await viewRef.current!.pickModel('Image A')
      await viewRef.current!.setModelKind('imageModel', 'Image A')
    })
    expect(clearChatRoute).not.toHaveBeenCalled()
    expect(patchSession).not.toHaveBeenCalled()
    expect(rememberStickyModel).not.toHaveBeenCalled()
  })

  it('A 会话晚回不污染 B 会话的 sticky', async () => {
    const first = deferred<AgentSession | null>()
    const second = deferred<AgentSession | null>()
    const patchSession = vi.fn(
      (sessionId: string) =>
        sessionId === 's1' ? first.promise : second.promise,
    )
    const rememberStickyModel = vi.fn()
    const props = input({ patchSession, rememberStickyModel })
    const { viewRef, update } = render(props)

    let firstWrite!: Promise<void>
    act(() => {
      firstWrite = viewRef.current!.setModelKind(
        'imageModel',
        'Image A',
      )
    })
    update({ ...props, current: session('s2', 'Image A') })
    let secondWrite!: Promise<void>
    act(() => {
      secondWrite = viewRef.current!.setModelKind(
        'imageModel',
        'Video A',
      )
    })

    await act(async () => {
      second.resolve(session('s2', 'Video A'))
      await secondWrite
    })
    await act(async () => {
      first.resolve(session('s1', 'Image A'))
      await firstWrite
    })

    expect(patchSession).toHaveBeenCalledWith('s1', {
      imageModel: 'Image A',
    })
    expect(patchSession).toHaveBeenCalledWith('s2', {
      imageModel: 'Video A',
    })
    expect(rememberStickyModel).toHaveBeenCalledWith(
      's1',
      'image',
      'Image A',
    )
    expect(rememberStickyModel).toHaveBeenCalledWith(
      's2',
      'image',
      'Video A',
    )
  })
})
