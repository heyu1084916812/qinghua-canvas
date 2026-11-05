import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelAdapter } from '../../../platform/channels/types'
import type { Channel } from '../../../domain/project/channel'
import { createChannel } from '../../../domain/project/channel'
import { buildGenerationRoutePlan } from '../../../domain/project/generationRouting'
import type { ModelCapability } from '../../../domain/shared/capability'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { buildRunPlan } from '../../../features/canvas/execution/buildRunPlan'
import { buildGroupRunPlan } from '../../../features/canvas/execution/groupRunPlan'
import { createMemoryPlatform } from '../../../platform/memory'
import {
  createCanvasStore,
  type CanvasStore,
} from '../../../state/workbenches/canvas/store'
import {
  adapterKey,
  prepareCanvasRun,
  type CanvasRunPreflightInput,
} from './canvasRunPreflight'

registerAllSpecs()

const stores = new Set<CanvasStore>()

afterEach(() => {
  for (const store of stores) store.dispose()
  stores.clear()
})

const model = (id: string): ModelCapability => ({
  id,
  category: 'image',
  inputTypes: ['text'],
})

function channelFixture(): Channel {
  const models = [model('image-model')]
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

function nodeIdOf(result: ReturnType<CanvasStore['dispatch']>): string {
  return (result.patches[0] as unknown as { row: { id: string } }).row.id
}

function setup(): {
  store: CanvasStore
  channels: Channel[]
  createNode: (overrides?: Record<string, unknown>) => string
} {
  const platform = createMemoryPlatform()
  const store = createCanvasStore({
    platform,
    projectId: 'p1',
    debounceMs: 0,
  })
  stores.add(store)
  const channels = [channelFixture()]
  return {
    store,
    channels,
    createNode(overrides = {}) {
      return nodeIdOf(store.dispatch({
        kind: 'node.create',
        projectId: 'p1',
        type: 'generation',
        at: { x: 0, y: 0 },
        data: {
          mode: 'image',
          prompt: '画一只猫',
          channelId: 'ch-valid',
          model: 'image-model',
          ...overrides,
        },
      }))
    },
  }
}

function inputOf(
  channels: Channel[],
  plan: ReturnType<typeof buildRunPlan>,
  overrides: Partial<CanvasRunPreflightInput> = {},
): CanvasRunPreflightInput {
  return {
    plan,
    channels: () => channels,
    currentChannels: () => channels,
    routeStrategy: () => 'priority',
    hasLocalCli: false,
    loadCredential: vi.fn(async () => 'token'),
    planGenerationRoute: vi.fn(async ({ category, logicalModel }) =>
      buildGenerationRoutePlan({
        channels,
        category,
        logicalModel,
      }),
    ),
    resolveAdapter: vi.fn(async () => ({} as ChannelAdapter)),
    random: 0.5,
    ...overrides,
  }
}

describe('prepareCanvasRun', () => {
  it('成功时返回渠道与 Key 分组对应的适配器表和任务渠道', async () => {
    const { store, channels, createNode } = setup()
    const nodeId = createNode()
    const plan = buildRunPlan(
      'node',
      { originNodeId: nodeId },
      store.getSnapshot(),
      'single',
    )
    const adapter = {} as ChannelAdapter
    const resolveAdapter = vi.fn(async () => adapter)

    const result = await prepareCanvasRun(inputOf(channels, plan, {
      resolveAdapter,
    }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(resolveAdapter).toHaveBeenCalledTimes(1)
    expect(result.adapters.get(
      adapterKey(
        'ch-valid',
        undefined,
        plan.tasks[0]!.request.kind,
      ),
    )).toBe(adapter)
    expect(result.taskChannels.get(plan.tasks[0]!.id)).toEqual(['ch-valid'])
  })

  it('多任务路由失败时返回整批失败，不解析适配器', async () => {
    const { store, channels, createNode } = setup()
    const first = createNode()
    const second = createNode({ model: 'missing-model' })
    const plan = buildGroupRunPlan(store.getSnapshot(), [first, second])
    const resolveAdapter = vi.fn(async () => ({} as ChannelAdapter))

    const result = await prepareCanvasRun(inputOf(channels, plan, {
      resolveAdapter,
    }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toHaveLength(2)
    expect(result.failures.map((failure) => failure.nodeId).sort()).toEqual(
      [first, second].sort(),
    )
    expect(resolveAdapter).not.toHaveBeenCalled()
  })

  it('适配器解析失败时返回整批结构化失败', async () => {
    const { store, channels, createNode } = setup()
    const nodeId = createNode()
    const plan = buildRunPlan(
      'node',
      { originNodeId: nodeId },
      store.getSnapshot(),
      'single',
    )

    const result = await prepareCanvasRun(inputOf(channels, plan, {
      resolveAdapter: vi.fn(async () => {
        throw new Error('adapter down')
      }),
    }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      expect.objectContaining({
        nodeId,
        error: { kind: 'parse', raw: 'Error: adapter down' },
      }),
    ])
  })

  it('调用方 signal 已取消时直接返回 canceled，不读令牌或解析适配器', async () => {
    const { store, channels, createNode } = setup()
    const nodeId = createNode()
    const plan = buildRunPlan(
      'node',
      { originNodeId: nodeId },
      store.getSnapshot(),
      'single',
    )
    const abort = new AbortController()
    abort.abort()
    const loadCredential = vi.fn(async () => 'token')
    const resolveAdapter = vi.fn(async () => ({} as ChannelAdapter))

    const result = await prepareCanvasRun(inputOf(channels, plan, {
      signal: abort.signal,
      loadCredential,
      resolveAdapter,
    }))

    expect(result).toEqual({ ok: false, canceled: true, failures: [] })
    expect(loadCredential).not.toHaveBeenCalled()
    expect(resolveAdapter).not.toHaveBeenCalled()
  })
})
