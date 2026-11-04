import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { Channel } from '../../../../domain/project/channel'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  useAgentInitialLoadController,
  type AgentInitialLoadControllerInput,
} from './useAgentInitialLoadController'

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

/** 只用到 id，其余字段本模块不读。 */
function channel(id: string): Channel {
  return { id, enabled: true } as Channel
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

function input(
  patch: Partial<AgentInitialLoadControllerInput> = {},
): AgentInitialLoadControllerInput {
  const currentIdRef = { current: null as string | null }
  return {
    projectId: 'p1',
    trackRun: <T,>(work: () => Promise<T>) => work(),
    loadChannels: async () => undefined,
    liveChannels: () => [],
    currentIdRef,
    selectionVersionRef: { current: 0 },
    refresh: async () => ({ rows: [], applied: true }),
    presets: {
      loadAgentReviewModel: async () => null,
      loadAgentCanvasReview: async () => false,
      loadAgentDefault: async () => null,
    },
    setReviewModel: vi.fn(),
    setCanvasReview: vi.fn(),
    getSession: async () => null,
    createSession: vi.fn(async (values) => session(`created:${values.model}`)),
    /** 用收到的渠道数组算选项，才能证明「用的是实时渠道」而不是空快照。 */
    fallbackModelOptions: (channels) => ({
      chat: channels.map((item) => `${item.id}:chat`),
      image: channels.map((item) => `${item.id}:image`),
      video: channels.map((item) => `${item.id}:video`),
    }),
    logicalModelOf: (model) => model,
    defaultModelFor: (options, saved) =>
      saved && options.includes(saved) ? saved : (options[0] ?? ''),
    removeSession: vi.fn(async () => undefined),
    setList: vi.fn(),
    setCurrent: vi.fn(),
    setMessages: vi.fn(),
    notify: vi.fn(),
    logWarning: vi.fn(),
    wait: async () => undefined,
    ...patch,
  }
}

function render(props: AgentInitialLoadControllerInput): {
  update: (next: AgentInitialLoadControllerInput) => void
  unmount: () => void
} {
  function Probe(next: AgentInitialLoadControllerInput) {
    useAgentInitialLoadController(next)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe, props))
  })
  return {
    update: (next) => {
      act(() => renderer.update(createElement(Probe, next)))
    },
    unmount: () => {
      act(() => renderer.unmount())
    },
  }
}

/** 让挂起的 promise 链跑完（不进 act：这条链是旁路）。 */
async function flush(times = 12): Promise<void> {
  for (let tick = 0; tick < times; tick += 1) await Promise.resolve()
}

describe('useAgentInitialLoadController', () => {
  it('守卫①：卸载（alive=false）后 load 完成也不再继续', async () => {
    const gate = deferred<void>()
    const refresh = vi.fn(async () => ({ rows: [], applied: true }))
    const controller = render(
      input({
        loadChannels: () => gate.promise,
        refresh,
      }),
    )

    controller.unmount()
    gate.resolve()
    await flush()

    expect(refresh).not.toHaveBeenCalled()
  })

  it('守卫②：load 期间已有 currentId 就不加载、不建会话', async () => {
    const gate = deferred<void>()
    const currentIdRef = { current: null as string | null }
    const refresh = vi.fn(async () => ({ rows: [], applied: true }))
    const createSession = vi.fn(async () => session('created'))
    render(
      input({
        currentIdRef,
        loadChannels: async () => {
          currentIdRef.current = 'user'
          await gate.promise
        },
        refresh,
        createSession,
      }),
    )

    gate.resolve()
    await flush()

    expect(refresh).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it('守卫③：load 期间 selectionVersion 变了就不加载', async () => {
    const gate = deferred<void>()
    const selectionVersionRef = { current: 0 }
    const refresh = vi.fn(async () => ({ rows: [], applied: true }))
    render(
      input({
        selectionVersionRef,
        loadChannels: async () => {
          selectionVersionRef.current += 1
          await gate.promise
        },
        refresh,
      }),
    )

    gate.resolve()
    await flush()

    expect(refresh).not.toHaveBeenCalled()
  })

  it('建会话用的是 load 之后的实时渠道，而不是渲染时那份', async () => {
    let loaded = false
    const createSession = vi.fn(async () => session('created'))
    render(
      input({
        loadChannels: async () => {
          loaded = true
        },
        liveChannels: () =>
          loaded ? [channel('a'), channel('b'), channel('c')] : [],
        createSession,
      }),
    )

    await flush()

    expect(createSession).toHaveBeenCalledTimes(1)
    expect(createSession).toHaveBeenCalledWith({
      projectId: 'p1',
      channelId: '',
      model: 'a:chat',
      imageModel: 'a:image',
      videoModel: 'a:video',
    })
  })

  it('偏好读取失败不拦路：继续加载，按默认值收起', async () => {
    const refresh = vi.fn(async () => ({ rows: [], applied: true }))
    const createSession = vi.fn(async () => session('created'))
    const setReviewModel = vi.fn()
    const setCanvasReview = vi.fn()
    render(
      input({
        presets: {
          loadAgentReviewModel: async () => {
            throw new Error('review read failed')
          },
          loadAgentCanvasReview: async () => {
            throw new Error('canvas review read failed')
          },
          loadAgentDefault: async () => null,
        },
        refresh,
        createSession,
        setReviewModel,
        setCanvasReview,
      }),
    )

    await flush()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(setReviewModel).toHaveBeenCalledWith('')
    expect(setCanvasReview).toHaveBeenCalledWith(false)
  })

  it('孤儿清理失败：只提示一次 + 只记一条结构化日志', async () => {
    const currentIdRef = { current: null as string | null }
    const notify = vi.fn()
    const logWarning = vi.fn()
    const removeSession = vi.fn(async () => {
      throw new Error('cleanup failed')
    })
    render(
      input({
        currentIdRef,
        refresh: async () => ({ rows: [], applied: true }),
        createSession: async () => {
          /** 建出来的同时用户就接手了 → 这条变成要清理的孤儿。 */
          currentIdRef.current = 'user'
          return session('initial-created')
        },
        removeSession,
        notify,
        logWarning,
      }),
    )

    await flush(30)

    expect(removeSession.mock.calls.length).toBeGreaterThan(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('会话'),
      'error',
    )
    expect(logWarning).toHaveBeenCalledTimes(1)
    expect(logWarning).toHaveBeenCalledWith(
      '[agent] initial session cleanup failed',
      expect.objectContaining({ sessionId: 'initial-created' }),
    )
  })

  it('迟到结果不写状态：卸载后 refresh 才回来，setCurrent/setMessages 都不调用', async () => {
    const gate = deferred<{ rows: AgentSession[]; applied: boolean }>()
    const setCurrent = vi.fn()
    const setMessages = vi.fn()
    const setList = vi.fn()
    const controller = render(
      input({
        refresh: () => gate.promise,
        setCurrent,
        setMessages,
        setList,
      }),
    )

    await flush()
    controller.unmount()
    gate.resolve({ rows: [session('head')], applied: true })
    await flush()

    expect(setCurrent).not.toHaveBeenCalled()
    expect(setMessages).not.toHaveBeenCalled()
    expect(setList).not.toHaveBeenCalled()
  })

  it('正常路径：刷新到已有会话就直接加载，不建新会话', async () => {
    const head = session('head')
    const createSession = vi.fn(async () => session('created'))
    const setCurrent = vi.fn()
    const setMessages = vi.fn()
    render(
      input({
        refresh: async () => ({ rows: [head], applied: true }),
        getSession: async () => ({ ...head, messages: [] }),
        createSession,
        setCurrent,
        setMessages,
      }),
    )

    await flush()

    expect(createSession).not.toHaveBeenCalled()
    expect(setCurrent).toHaveBeenCalledWith(expect.objectContaining({ id: 'head' }))
    expect(setMessages).toHaveBeenCalledTimes(1)
  })

  it('读取会话失败：提示一次错误，不建会话', async () => {
    const createSession = vi.fn(async () => session('created'))
    const notify = vi.fn()
    render(
      input({
        refresh: async () => {
          throw new Error('list failed')
        },
        createSession,
        notify,
      }),
    )

    await flush()

    expect(createSession).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Agent 会话读取失败'),
      'error',
    )
  })
})
