import { createElement, type ReactNode } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { PlatformProvider } from '../../../app/providers/PlatformProvider'
import { ChannelStoreContext } from '../../../app/providers/ChannelStoreProvider'
import { SkillStoreContext } from '../../../app/providers/SkillStoreProvider'
import {
  buildGenerationRoutePlan,
} from '../../../domain/project/generationRouting'
import {
  createChannel,
  type Channel,
} from '../../../domain/project/channel'
import type { ModelCapability } from '../../../domain/shared/capability'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import type { ChannelStore } from '../../../state/channel/channelStore'
import { createMemoryPlatform } from '../../../platform/memory'
import {
  createCanvasStore,
  type CanvasStore,
} from '../../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../storeContext'
import {
  CanvasExecutionProvider,
  CanvasRunPreflightError,
  useCanvasExecution,
  type CanvasExecutionApi,
} from './CanvasExecutionProvider'
import {
  activateCanvasExecutionRuntime,
  disposeAllCanvasExecutionRuntimes,
  disposeCanvasExecutionRuntime,
  resetCanvasExecutionRuntimesForTests,
} from './canvasExecutionRuntime'
import { resetCanvasRunStatesForTests } from './canvasRunState'

const generationMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  completeText: vi.fn(),
}))

vi.mock('../../../platform/generation', () => ({
  createGenerationClient: () => generationMocks,
}))

registerAllSpecs()

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const roots = new Set<TestRenderer.ReactTestRenderer>()
const stores = new Set<CanvasStore>()

beforeEach(() => {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    innerWidth: 1440,
    innerHeight: 900,
  })
  generationMocks.resolve.mockReset()
  generationMocks.completeText.mockReset()
})

afterEach(async () => {
  for (const root of roots) act(() => root.unmount())
  roots.clear()
  for (const store of stores) store.dispose()
  stores.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetCanvasRunStatesForTests()
  await disposeAllCanvasExecutionRuntimes()
  resetCanvasExecutionRuntimesForTests()
})

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function model(
  id: string,
  category: 'image' | 'chat',
): ModelCapability {
  return {
    id,
    category,
    inputTypes: ['text', 'image'],
  }
}

function channelFixture(): Channel {
  const models = [
    model('image-model', 'image'),
    model('chat-model', 'chat'),
  ]
  return {
    ...createChannel({
      name: 'Mock',
      protocol: 'mock',
      baseUrl: '',
    }),
    id: 'ch-valid',
    enabled: true,
    hasToken: true,
    models,
    modelCache: models,
    modelMap: {},
    credentialGroups: [],
  }
}

function channelStoreFixture(
  channels: readonly Channel[],
): ChannelStore {
  return {
    getState: () => ({
      channels,
      routeStrategy: 'priority',
    }),
    protocolCatalog: () => ({}),
    planGenerationRoute: vi.fn(
      async ({
        category,
        logicalModel,
      }: {
        category: 'image' | 'video' | 'chat'
        logicalModel: string
      }) =>
        buildGenerationRoutePlan({
          channels,
          category,
          logicalModel,
        }),
    ),
  } as unknown as ChannelStore
}

function skillStoreFixture(
  skills: readonly {
    id: string
    name: string
    content: string
    inputMode: 'text' | 'image' | 'text-image'
  }[],
) {
  return {
    skills,
    builtinSkills: [],
    userSkills: [],
    loading: false,
    reload: vi.fn(async () => undefined),
    create: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    copyBuiltin: vi.fn(),
    restoreBuiltin: vi.fn(),
  }
}

function nodeIdOf(result: ReturnType<CanvasStore['dispatch']>): string {
  return (result.patches[0] as unknown as { row: { id: string } }).row.id
}

function createNode(
  store: CanvasStore,
  type: 'generation' | 'prompt' | 'loop' | 'batch',
  data: Record<string, unknown>,
): string {
  return nodeIdOf(store.dispatch({
    kind: 'node.create',
    projectId: 'p1',
    type,
    at: { x: 0, y: 0 },
    data,
  }))
}

async function mountProvider(input: {
  store: CanvasStore
  channels: ChannelStore
  skills?: ReturnType<typeof skillStoreFixture>
}): Promise<() => CanvasExecutionApi> {
  let api!: CanvasExecutionApi

  function Probe() {
    api = useCanvasExecution()
    return null
  }

  const children: ReactNode = createElement(
    PlatformProvider,
    { runtime: 'memory' },
    createElement(
      ChannelStoreContext.Provider,
      { value: input.channels },
      createElement(
        SkillStoreContext.Provider,
        { value: (input.skills ?? skillStoreFixture([])) as never },
        createElement(
          CanvasStoreProvider,
          {
            store: input.store,
            children: createElement(
              CanvasExecutionProvider,
              null,
              createElement(Probe),
            ),
          },
        ),
      ),
    ),
  )

  let root!: TestRenderer.ReactTestRenderer
  await act(async () => {
    root = TestRenderer.create(children)
    await Promise.resolve()
  })
  roots.add(root)
  return () => api
}

function setup(data: Record<string, unknown> = {}) {
  const platform = createMemoryPlatform()
  const store = createCanvasStore({
    platform,
    projectId: 'p1',
    debounceMs: 0,
  })
  stores.add(store)
  activateCanvasExecutionRuntime('p1')
  return {
    platform,
    store,
    channels: channelStoreFixture([channelFixture()]),
    data,
  }
}

function pendingAdapter(
  started: ReturnType<typeof deferred<void>>,
): {
  adapter: {
    generateImage: (
      request: unknown,
      signal: AbortSignal,
    ) => Promise<never>
  }
  signal: () => AbortSignal | undefined
} {
  let seen: AbortSignal | undefined
  return {
    adapter: {
      generateImage: async (_request, signal) => {
        seen = signal
        started.resolve()
        if (signal.aborted) throw abortError()
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
          })
        })
      },
    },
    signal: () => seen,
  }
}

async function settlesWithin(promise: Promise<unknown>, ms = 1_000): Promise<void> {
  await Promise.race([
    promise.then(() => undefined),
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`did not settle within ${ms}ms`)), ms)
    }),
  ])
}

describe('CanvasExecutionProvider run preflight behavior', () => {
  it('prompt skill 分支使用调用方 signal，取消后停止 LLM', async () => {
    const { store, channels } = setup()
    const promptId = createNode(store, 'prompt', {
      draft: '写一个提示词',
      text: '',
      channelId: 'ch-valid',
      model: 'chat-model',
      skillId: 'skill-1',
    })
    const started = deferred<AbortSignal>()
    generationMocks.completeText.mockImplementation(
      (_request: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          started.resolve(signal)
          signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
          })
        }),
    )
    const getApi = await mountProvider({
      store,
      channels,
      skills: skillStoreFixture([{
        id: 'skill-1',
        name: 'Skill',
        content: 'system',
        inputMode: 'text',
      }]),
    })
    const api = getApi()
    const abort = new AbortController()
    const running = api.runNode(promptId, { signal: abort.signal })
    const llmSignal = await started.promise

    abort.abort()

    await act(async () => {
      await settlesWithin(running)
    })
    expect(llmSignal.aborted).toBe(true)
    expect(generationMocks.completeText).toHaveBeenCalledTimes(1)
  })

  it('compose 分支使用调用方 signal，取消后停止 LLM', async () => {
    const { store, channels } = setup()
    const promptId = createNode(store, 'prompt', {
      draft: '写一个提示词',
      text: '',
      channelId: 'ch-valid',
      model: 'chat-model',
    })
    const started = deferred<AbortSignal>()
    generationMocks.completeText.mockImplementation(
      (_request: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          started.resolve(signal)
          signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
          })
        }),
    )
    const getApi = await mountProvider({ store, channels })
    const api = getApi()
    const abort = new AbortController()
    const running = api.runNode(promptId, { signal: abort.signal })
    const llmSignal = await started.promise

    abort.abort()

    await act(async () => {
      await settlesWithin(running)
    })
    expect(llmSignal.aborted).toBe(true)
    expect(generationMocks.completeText).toHaveBeenCalledTimes(1)
  })

  it('项目运行态关闭会中止准备阶段的 LLM', async () => {
    const { store, channels } = setup()
    const promptId = createNode(store, 'prompt', {
      draft: '写一个提示词',
      text: '',
      channelId: 'ch-valid',
      model: 'chat-model',
      skillId: 'skill-1',
    })
    const started = deferred<AbortSignal>()
    generationMocks.completeText.mockImplementation(
      (_request: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          started.resolve(signal)
          signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
          })
        }),
    )
    const getApi = await mountProvider({
      store,
      channels,
      skills: skillStoreFixture([{
        id: 'skill-1',
        name: 'Skill',
        content: 'system',
        inputMode: 'text',
      }]),
    })
    const running = getApi().runNode(promptId)
    const llmSignal = await started.promise

    await act(async () => {
      await disposeCanvasExecutionRuntime('p1', 1_000)
      await settlesWithin(running)
    })
    expect(llmSignal.aborted).toBe(true)
  })

  it.each(['loop', 'batch'] as const)(
    '%s 分支把调用方 signal 传到渠道请求，取消后停止付费调用',
    async (kind) => {
      const { store, channels } = setup()
      const generationId = createNode(store, 'generation', {
        mode: 'image',
        prompt: '画一只猫',
        channelId: 'ch-valid',
        model: 'image-model',
      })
      const containerId = createNode(
        store,
        kind,
        kind === 'loop'
          ? {
              count: 1,
              loopStart: 1,
              batch: 1,
              mode: 'serial',
              useImageInput: false,
              usePrompt: false,
              prompts: [],
            }
          : {},
      )
      store.dispatch({
        kind: 'edge.connect',
        source: containerId,
        target: generationId,
      })
      const started = deferred<void>()
      const pending = pendingAdapter(started)
      generationMocks.resolve.mockResolvedValue({ adapter: pending.adapter })
      const getApi = await mountProvider({ store, channels })
      const api = getApi()
      const abort = new AbortController()
      const running = api.runNode(containerId, { signal: abort.signal })

      await started.promise
      abort.abort()

      await act(async () => {
        await settlesWithin(running)
      })
      expect(pending.signal()?.aborted).toBe(true)
    },
  )

  it('多任务路由失败时整批进入 failed，并返回结构化错误', async () => {
    const { store, channels } = setup()
    const okId = createNode(store, 'generation', {
      mode: 'image',
      prompt: 'ok',
      channelId: 'ch-valid',
      model: 'image-model',
    })
    const badId = createNode(store, 'generation', {
      mode: 'image',
      prompt: 'bad',
      channelId: 'ch-valid',
      model: 'missing-model',
    })
    generationMocks.resolve.mockResolvedValue({
      adapter: { generateImage: vi.fn() },
    })
    const getApi = await mountProvider({ store, channels })
    const api = getApi()

    let failure: unknown
    await act(async () => {
      try {
        await api.runGroup([okId, badId])
      } catch (error) {
        failure = error
      }
    })
    expect(failure).toBeInstanceOf(CanvasRunPreflightError)
    expect((failure as CanvasRunPreflightError).failures).toHaveLength(2)
    expect(getApi().nodeStateOf(okId)?.kind).toBe('failed')
    expect(getApi().nodeStateOf(badId)?.kind).toBe('failed')
    expect(generationMocks.resolve).not.toHaveBeenCalled()
  })

  it('适配器解析失败时整批 failed，并向 signal 调用方抛出结构化错误', async () => {
    const { store, channels } = setup()
    const nodeId = createNode(store, 'generation', {
      mode: 'image',
      prompt: '画一只猫',
      channelId: 'ch-valid',
      model: 'image-model',
    })
    generationMocks.resolve.mockRejectedValue(new Error('adapter down'))
    const getApi = await mountProvider({ store, channels })
    const api = getApi()
    const abort = new AbortController()

    let failure: unknown
    await act(async () => {
      try {
        await api.runNode(nodeId, { signal: abort.signal })
      } catch (error) {
        failure = error
      }
    })

    expect(failure).toBeInstanceOf(CanvasRunPreflightError)
    expect((failure as CanvasRunPreflightError).failures).toHaveLength(1)
    expect(getApi().nodeStateOf(nodeId)).toMatchObject({
      kind: 'failed',
      error: { kind: 'parse', raw: 'Error: adapter down' },
    })
  })
})
