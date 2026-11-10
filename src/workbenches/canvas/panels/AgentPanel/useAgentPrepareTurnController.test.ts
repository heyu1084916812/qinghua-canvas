import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentPrepareArgs } from './agentSendTurnRun'
import type { PrepareAgentTurnRequestInput } from './agentTurnRequest'
import {
  useAgentPrepareTurnController,
  type AgentPrepareTurn,
  type AgentPrepareTurnControllerInput,
} from './useAgentPrepareTurnController'

function session(id = 's1'): AgentSession {
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

function harness(over: Partial<AgentPrepareTurnControllerInput> = {}) {
  const captured: PrepareAgentTurnRequestInput[] = []
  const snapshots = { current: { projectId: 'proj-1', nodes: [], edges: [] } }
  const store = {
    getSnapshot: vi.fn(() => snapshots.current as never),
    notify: vi.fn(),
  }
  const read = vi.fn(async () => ({ mime: 'image/png' }))
  const prepareChatRoute = vi.fn(async () => ({ ok: true }) as never)
  const referenceRows = [
    {
      id: 'r1',
      projectId: 'proj-1',
      title: '品牌标准字',
      source: 'kit',
      kind: 'image',
      assetHash: 'hash-logo',
      what: '绿色圆角标准字',
      createdAt: 1,
      updatedAt: 1,
    },
  ]
  const referenceUsageRows = [
    {
      id: 'u1',
      itemId: 'r1',
      projectId: 'proj-1',
      taskKey: 'simple_generate',
      usage: 'identityAnchor',
      howToUse: '保持字形与颜色不变',
      identityAnchor: true,
      createdAt: 1,
    },
  ]
  const storage = {
    query: vi.fn(async (table: string) => {
      if (table === 'referenceItems') return referenceRows
      if (table === 'referenceUsages') return referenceUsageRows
      return []
    }),
  }
  const prepare = vi.fn(async (input: PrepareAgentTurnRequestInput) => {
    captured.push(input)
    return { kind: 'aborted_before_job', persistedTurn: {} } as never
  })
  const input: AgentPrepareTurnControllerInput = {
    store: store as never,
    platform: {
      assets: { read },
      storage,
    } as never,
    prepareChatRoute: prepareChatRoute as never,
    selection: ['n1'],
    sessions: { get: vi.fn() } as never,
    memory: { read: vi.fn() } as never,
    allSkills: [{ id: 'skill-1' }] as never,
    allChannels: [{ id: 'ch-1' }] as never,
    canvasReviewEnabled: true,
    activeAgentTools: [{ name: 'node.create' }] as never,
    generationAvailability: { image: true } as never,
    routeExecution: { execute: vi.fn() } as never,
    prepare: prepare as never,
    ...over,
  }
  return {
    input,
    captured,
    store,
    read,
    prepareChatRoute,
    prepare,
    snapshots,
    storage,
  }
}

function render(props: AgentPrepareTurnControllerInput): {
  viewRef: { current: AgentPrepareTurn | null }
  update: (next: AgentPrepareTurnControllerInput) => void
} {
  const viewRef: { current: AgentPrepareTurn | null } = { current: null }
  function Probe(next: AgentPrepareTurnControllerInput) {
    viewRef.current = useAgentPrepareTurnController(next)
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

const args = (over: Partial<AgentPrepareArgs> = {}): AgentPrepareArgs => {
  const onPersisted = vi.fn()
  const onRouteReady = vi.fn(async () => {})
  return {
    session: session('s1'),
    text: '画一张海报',
    internalControl: false,
    signal: new AbortController().signal,
    hooks: { onPersisted, onRouteReady },
    ...over,
  }
}

describe('useAgentPrepareTurnController / 12 个静态依赖原样透传', () => {
  it('逐字段核对（表驱动）', async () => {
    const h = harness()
    const { viewRef } = render(h.input)
    const a = args()

    await viewRef.current!(a)

    const input = h.captured[0]!
    expect(input.selection).toBe(h.input.selection)
    expect(input.sessions).toBe(h.input.sessions)
    expect(input.memory).toBe(h.input.memory)
    expect(input.skills).toBe(h.input.allSkills)
    expect(input.channels).toBe(h.input.allChannels)
    expect(input.canvasReviewEnabled).toBe(true)
    expect(input.activeAgentTools).toBe(h.input.activeAgentTools)
    expect(input.generationAvailability).toBe(
      h.input.generationAvailability,
    )
    expect(input.routeExecution).toBe(h.input.routeExecution)
    expect(input.projectId).toBe('proj-1')
    expect(input.referenceLedger).toBeTruthy()
    expect(input.autoCurateReferences).toBeTypeOf('function')
    // 调用参数原样
    expect(input.session).toBe(a.session)
    expect(input.text).toBe('画一张海报')
    expect(input.internalControl).toBe(false)
    expect(input.signal).toBe(a.signal)
  })

  it('两个 notify 端口各自成句', async () => {
    const h = harness()
    const { viewRef } = render(h.input)

    await viewRef.current!(args())
    const input = h.captured[0]!
    input.notifyContextError('上下文炸了')
    input.notifyRecordWarning('写入失败')

    expect(h.store.notify).toHaveBeenNthCalledWith(
      1,
      '上下文炸了',
      'error',
    )
    expect(h.store.notify).toHaveBeenNthCalledWith(
      2,
      '结果已返回，但运行记录写入失败：写入失败',
      'error',
    )
  })

  it('readAssetMime：成功取 mime，读失败回落 null', async () => {
    const h = harness()
    const { viewRef } = render(h.input)

    await viewRef.current!(args())
    const input = h.captured[0]!

    await expect(input.readAssetMime('h1')).resolves.toBe('image/png')
    h.read.mockRejectedValueOnce(new Error('boom'))
    await expect(input.readAssetMime('h2')).resolves.toBeNull()
  })

  it('prepareRoute 一定带 fresh=true（不许退化成缓存路由）', async () => {
    const h = harness()
    const { viewRef } = render(h.input)
    const a = args()

    await viewRef.current!(a)
    await h.captured[0]!.prepareRoute()

    expect(h.prepareChatRoute).toHaveBeenCalledWith(a.session, true)
  })

  it('参考台账由真实 platform.storage 装配，按项目与稳定任务类型筛选', async () => {
    const h = harness()
    const { viewRef } = render(h.input)

    await viewRef.current!(args())
    const referenceLedger = h.captured[0]!.referenceLedger!
    const selected = await referenceLedger.selectForTask(
      'proj-1',
      'simple_generate',
    )

    expect(h.storage.query).toHaveBeenCalledWith('referenceItems', {
      projectId: 'proj-1',
    })
    expect(h.storage.query).toHaveBeenCalledWith('referenceUsages', {
      projectId: 'proj-1',
      taskKey: 'simple_generate',
    })
    expect(selected.selected.map(({ item }) => item.id)).toEqual(['r1'])
    expect(selected.omitted).toEqual([])
  })
})

describe('useAgentPrepareTurnController / 快照时机', () => {
  it('graph / projectId 每次调用现取，且是两次独立快照', async () => {
    const h = harness()
    const { viewRef } = render(h.input)

    await viewRef.current!(args())
    h.snapshots.current = { projectId: 'proj-2', nodes: [], edges: [] }
    await viewRef.current!(args())

    expect(h.captured[0]!.projectId).toBe('proj-1')
    expect(h.captured[1]!.projectId).toBe('proj-2')
    // 一次调用 = 两次 getSnapshot（graph 与 projectId 各自取）
    expect(h.store.getSnapshot).toHaveBeenCalledTimes(4)
    expect(h.captured[1]!.graph).toBe(h.snapshots.current)
  })

  it('selection 是渲染快照：同一回调两次调用相同，重渲染后换成新的', async () => {
    const h = harness()
    const { viewRef, update } = render(h.input)

    await viewRef.current!(args())
    await viewRef.current!(args())
    expect(h.captured[0]!.selection).toBe(h.input.selection)
    expect(h.captured[1]!.selection).toBe(h.input.selection)

    const next = ['n2']
    update({ ...h.input, selection: next })
    await viewRef.current!(args())
    expect(h.captured[2]!.selection).toBe(next)
  })
})

describe('useAgentPrepareTurnController / 回调与失败', () => {
  it('onPersisted / onRouteReady 是宿主的同一引用', async () => {
    const h = harness()
    const { viewRef } = render(h.input)
    const a = args()

    await viewRef.current!(a)
    const input = h.captured[0]!

    expect(input.onPersisted).toBe(a.hooks.onPersisted)
    expect(input.onRouteReady).toBe(a.hooks.onRouteReady)
    input.onPersisted({} as never)
    expect(a.hooks.onPersisted).toHaveBeenCalledTimes(1)
  })

  it('prepare 抛错原样上抛，不吞', async () => {
    const failure = new Error('prepare failed')
    const h = harness({
      prepare: vi.fn(async () => {
        throw failure
      }) as never,
    })
    const { viewRef } = render(h.input)

    await expect(viewRef.current!(args())).rejects.toBe(failure)
  })
})
