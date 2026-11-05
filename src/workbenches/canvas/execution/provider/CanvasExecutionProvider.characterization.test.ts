import { createElement, type ReactNode } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../../../../app/providers/PlatformProvider'
import { ChannelStoreContext } from '../../../../app/providers/ChannelStoreProvider'
import { SkillStoreContext } from '../../../../app/providers/SkillStoreProvider'
import { PresetTextContext } from '../../../../app/providers/PresetTextProvider'
import {
  createChannel,
  type Channel,
} from '../../../../domain/project/channel'
import { buildGenerationRoutePlan } from '../../../../domain/project/generationRouting'
import type { ModelCapability } from '../../../../domain/shared/capability'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import { imageCountOf } from '../../../../domain/ui/notify'
import type { GeneratedAsset } from '../../../../platform/channels/types'
import { createMemoryPlatform } from '../../../../platform/memory'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import {
  createCanvasStore,
  type CanvasStore,
} from '../../../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../../storeContext'
import {
  CanvasExecutionProvider,
  useCanvasExecution,
  type CanvasExecutionApi,
} from '../CanvasExecutionProvider'
import {
  activateCanvasExecutionRuntime,
  canvasExecutionRuntimeFor,
  disposeAllCanvasExecutionRuntimes,
  resetCanvasExecutionRuntimesForTests,
} from '../canvasExecutionRuntime'
import {
  canvasRunStatesOf,
  resetCanvasRunStatesForTests,
  updateCanvasRunState,
} from '../canvasRunState'

const generationMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  completeText: vi.fn(),
}))

vi.mock('../../../../platform/generation', () => ({
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

function model(id: string, category: 'image' | 'chat'): ModelCapability {
  return { id, category, inputTypes: ['text', 'image'] }
}

function channelFixture(): Channel {
  const models = [model('image-model', 'image'), model('chat-model', 'chat')]
  return {
    ...createChannel({ name: 'Mock', protocol: 'mock', baseUrl: '' }),
    id: 'ch-valid',
    enabled: true,
    hasToken: true,
    models,
    modelCache: models,
    modelMap: {},
    credentialGroups: [],
  }
}

function channelStoreFixture(channels: readonly Channel[]): ChannelStore {
  return {
    getState: () => ({ channels, routeStrategy: 'priority' }),
    protocolCatalog: () => ({}),
    planGenerationRoute: vi.fn(
      ({
        category,
        logicalModel,
      }: {
        category: 'image' | 'video' | 'chat'
        logicalModel: string
      }) =>
        buildGenerationRoutePlan({ channels, category, logicalModel }),
    ),
  } as unknown as ChannelStore
}

function skillStoreFixture() {
  return {
    skills: [],
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
  type: 'generation' | 'batch' | 'fusion',
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

async function mountProvider(store: CanvasStore): Promise<() => CanvasExecutionApi> {
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
      { value: channelStoreFixture([channelFixture()]) },
      createElement(
        SkillStoreContext.Provider,
        { value: skillStoreFixture() as never },
        createElement(
          PresetTextContext.Provider,
          {
            value: {
              overrides: {},
              loading: false,
              reload: vi.fn(async () => undefined),
              save: vi.fn(async () => undefined),
            },
          },
          createElement(
            CanvasStoreProvider,
            {
              store,
              children: createElement(
                CanvasExecutionProvider,
                null,
                createElement(Probe),
              ),
            },
          ),
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

function setup() {
  const platform = createMemoryPlatform()
  const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
  stores.add(store)
  activateCanvasExecutionRuntime('p1')
  return { platform, store }
}

function generationData(prompt: string) {
  return {
    mode: 'image',
    prompt,
    channelId: 'ch-valid',
    model: 'image-model',
  }
}

function asset(hash: string): GeneratedAsset {
  return {
    hash,
    mime: 'image/png',
    bytes: new Uint8Array([1]),
    width: 8,
    height: 8,
  }
}

function successfulAdapter(hash: string) {
  return {
    generateImage: vi.fn(async ({ prompt }: { prompt: string }) => [asset(`${hash}:${prompt}`)]),
  }
}

describe('CanvasExecutionProvider characterization', () => {
  it('公开八项 API、必需 signal 契约与宿主 getter 不变', async () => {
    const { store } = setup()
    const getApi = await mountProvider(store)
    const api = getApi()

    expect(Object.keys(api).sort()).toEqual([
      'appendRecord',
      'cancel',
      'completeText',
      'isRunning',
      'nodeStateOf',
      'nodeStates',
      'runGroup',
      'runNode',
    ])
    expect(typeof api.runNode).toBe('function')
    expect(typeof api.runGroup).toBe('function')
    expect(typeof api.cancel).toBe('function')
    expect(typeof api.nodeStateOf).toBe('function')
    expect(typeof api.appendRecord).toBe('function')
    expect(typeof api.completeText).toBe('function')
    expect(api.completeText.length).toBe(1)

    updateCanvasRunState('p1', 'n-getter', { kind: 'running', startedAt: 1 })
    const runtime = canvasExecutionRuntimeFor('p1')
    runtime.engine.begin('plan-getter', new AbortController())
    expect(getApi().nodeStates).toBe(canvasRunStatesOf('p1'))
    expect(getApi().nodeStateOf('n-getter')).toMatchObject({ kind: 'running' })
    expect(getApi().isRunning).toBe(true)
    expect(imageCountOf([{ state: { kind: 'succeeded', result: [asset('a')] } }])).toBe(1)
  })

  it('调用前已取消时既不预检也不触网', async () => {
    const { store } = setup()
    const nodeId = createNode(store, 'generation', generationData('cat'))
    generationMocks.resolve.mockResolvedValue({ adapter: successfulAdapter('never') })
    const api = (await mountProvider(store))()
    const abort = new AbortController()
    abort.abort()

    await act(async () => {
      await api.runNode(nodeId, { signal: abort.signal })
    })

    expect(generationMocks.resolve).not.toHaveBeenCalled()
    expect(generationMocks.completeText).not.toHaveBeenCalled()
  })

  it('预检失败时整批 failed、零请求，并向 signal 调用方返回结构化错误', async () => {
    const { store } = setup()
    const okId = createNode(store, 'generation', generationData('ok'))
    const badId = createNode(store, 'generation', {
      ...generationData('bad'),
      model: 'missing-model',
    })
    generationMocks.resolve.mockResolvedValue({ adapter: successfulAdapter('never') })
    const api = (await mountProvider(store))()
    const abort = new AbortController()
    let failure: unknown

    await act(async () => {
      try {
        await api.runGroup([okId, badId])
      } catch (error) {
        failure = error
      }
    })

    expect((failure as Error).name).toBe('CanvasRunPreflightError')
    expect(canvasRunStatesOf('p1').get(okId)).toMatchObject({ kind: 'failed' })
    expect(canvasRunStatesOf('p1').get(badId)).toMatchObject({ kind: 'failed' })
    expect(generationMocks.resolve).not.toHaveBeenCalled()
    expect(abort.signal.aborted).toBe(false)
  })

  it('正常单节点依次提交资产、节点结果与 RunRecord，再 flush', async () => {
    const { store } = setup()
    const nodeId = createNode(store, 'generation', generationData('single'))
    generationMocks.resolve.mockResolvedValue({ adapter: successfulAdapter('single') })
    const api = (await mountProvider(store))()
    const events: string[] = []
    const dispatch = store.dispatch.bind(store)
    vi.spyOn(store, 'dispatch').mockImplementation((command, transaction) => {
      if (command.kind === 'asset.put' ||
          command.kind === 'node.updateData' ||
          command.kind === 'node.runRecord.append' ||
          command.kind === 'runPlan.execute') {
        events.push(command.kind)
      }
      return dispatch(command, transaction)
    })
    const flush = store.flush.bind(store)
    vi.spyOn(store, 'flush').mockImplementation(async () => {
      events.push('flush')
      return flush()
    })

    await act(async () => {
      await api.runNode(nodeId)
    })

    expect(events.indexOf('runPlan.execute')).toBeLessThan(events.indexOf('asset.put'))
    expect(events.indexOf('asset.put')).toBeLessThan(events.indexOf('node.updateData'))
    expect(events.indexOf('node.updateData')).toBeLessThan(
      events.indexOf('node.runRecord.append'),
    )
    expect(events.indexOf('node.runRecord.append')).toBeLessThan(events.indexOf('flush'))
    expect(events.filter((event) => event === 'flush')).toHaveLength(2)
    expect(canvasRunStatesOf('p1').size).toBe(0)
    expect(generationMocks.resolve).toHaveBeenCalledTimes(1)
  })

  it('批次按集合顺序展开，融合路径保留本地 RunRecord 且不触网', async () => {
    const { store } = setup()
    const first = createNode(store, 'generation', {
      ...generationData('first'),
      assetHash: 'source-1',
      naturalSize: { width: 8, height: 8 },
    })
    const second = createNode(store, 'generation', {
      ...generationData('second'),
      assetHash: 'source-2',
      naturalSize: { width: 8, height: 8 },
    })
    const batchId = createNode(store, 'batch', {
      mode: 'image',
      prompt: 'batch-brief',
      channelId: 'ch-valid',
      model: 'image-model',
    })
    for (const id of [first, second]) {
      store.dispatch({ kind: 'node.reparent', id, toParent: batchId })
    }
    const prompts: string[] = []
    generationMocks.resolve.mockResolvedValue({
      adapter: {
        generateImage: vi.fn(async ({ prompt }: { prompt: string }) => {
          prompts.push(prompt)
          return [asset(`batch:${prompt}`)]
        }),
      },
    })
    const api = (await mountProvider(store))()
    await act(async () => {
      await api.runNode(batchId)
    })

    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('first')
    expect(prompts[1]).toContain('second')
    expect(prompts[0]).toContain('batch-brief')
    expect(prompts[1]).toContain('batch-brief')

    const fusionId = createNode(store, 'fusion', {})
    const fusionRecords: unknown[] = []
    const originalDispatch = store.dispatch.bind(store)
    vi.spyOn(store, 'dispatch').mockImplementation((command, transaction) => {
      if (command.kind === 'node.runRecord.append') fusionRecords.push(command.record)
      return originalDispatch(command, transaction)
    })
    generationMocks.resolve.mockClear()
    await act(async () => {
      await api.runNode(fusionId)
    })
    expect(generationMocks.resolve).not.toHaveBeenCalled()
    expect(fusionRecords).toHaveLength(1)
    expect(fusionRecords[0]).toMatchObject({
      status: 'failed',
      sentChannelId: 'local',
      sentModel: '本地融合',
    })
  })

  it('并发队列按 planId 隔离，不串批且不误清另一计划的状态', async () => {
    const { store } = setup()
    const first = createNode(store, 'generation', generationData('plan-a'))
    const second = createNode(store, 'generation', generationData('plan-b'))
    const firstStarted = deferred<void>()
    const secondStarted = deferred<void>()
    const releaseFirst = deferred<void>()
    const releaseSecond = deferred<void>()
    const promptOrder: string[] = []

    generationMocks.resolve.mockResolvedValue({
      adapter: {
        generateImage: vi.fn(async ({ prompt }: { prompt: string }) => {
          promptOrder.push(prompt)
          if (prompt.includes('plan-a')) {
            firstStarted.resolve()
            await releaseFirst.promise
          } else {
            secondStarted.resolve()
            await releaseSecond.promise
          }
          return [asset(`concurrent:${prompt}`)]
        }),
      },
    })
    const api = (await mountProvider(store))()
    let firstRun!: Promise<void>
    let secondRun!: Promise<void>
    await act(async () => {
      firstRun = api.runNode(first)
      secondRun = api.runNode(second)
      await firstStarted.promise
      await secondStarted.promise
    })

    expect(canvasRunStatesOf('p1').get(first)).toMatchObject({ kind: 'running' })
    expect(canvasRunStatesOf('p1').get(second)).toMatchObject({ kind: 'running' })

    await act(async () => {
      releaseFirst.resolve()
      await firstRun
    })
    expect(canvasRunStatesOf('p1').get(first)).toBeUndefined()
    expect(canvasRunStatesOf('p1').get(second)).toMatchObject({ kind: 'running' })

    await act(async () => {
      releaseSecond.resolve()
      await secondRun
    })
    expect(promptOrder).toEqual(['plan-a', 'plan-b'])
    expect(canvasRunStatesOf('p1').size).toBe(0)
  })
})
