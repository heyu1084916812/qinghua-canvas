import { describe, expect, it, vi } from 'vitest'
import type {
  NodeInput,
} from '../../../../domain/shared/execution/types'
import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import type { TextRunRequest } from '../../../../platform/channels/types'
import type { TextResult } from '../../../../platform/channels/types'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { describeError } from '../../../../shared/result'
import {
  assembleAgentLoopDeps,
  type AgentLoopAssemblyPorts,
} from './agentLoopDeps'
import type { AgentChatRoute } from './agentChatRoute'

const ROUTE: AgentChatRoute = {
  channelId: 'channel-1',
  logicalModel: '测试对话模型',
  upstreamModel: 'upstream-1',
  routePlanId: 'plan',
  candidates: [],
}

const session: AgentSession = {
  id: 'session-loop',
  projectId: 'p1',
  title: '循环装配',
  channelId: '',
  model: '测试对话模型',
  queuedTurns: [],
  pendingSteers: [
    { id: 'steer-1', text: '再等一下', createdAt: 1 },
    { id: 'steer-2', text: '先做这个', createdAt: 2 },
  ],
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

const tool = (name: string): ToolDeclaration =>
  ({
    name,
    description: `${name} 工具`,
    parameters: { type: 'object', properties: {} },
  }) as ToolDeclaration

function harness(args: {
  turnTools?: readonly ToolDeclaration[]
  toolMode?: 'native' | 'json'
  controller?: AbortController
  route?: AgentChatRoute | null
  nodeRunStates?:
    | ReadonlyMap<string, { kind: 'failed'; error: unknown }>
    | (() => ReadonlyMap<string, { kind: 'failed'; error: unknown }>)
  delivered?: Set<string>
  runLatestFailures?: Map<string, unknown>
  applyPlanResult?: unknown
}) {
  const executions: Record<string, unknown>[] = []
  const statusUpdates: unknown[] = []
  const events: { id: string; type: string; payload?: unknown }[] = []
  const routeCache = new Map<string, AgentChatRoute>()
  const deliveredStore = new Map<string, Set<string>>()
  if (args.delivered) deliveredStore.set(session.id, args.delivered)
  const planAliasesStore = new Map<string, ReadonlyMap<string, string>>([
    [session.id, new Map([['ref1', 'node-9']])],
  ])
  const turnToolsStore = new Map<string, readonly ToolDeclaration[]>()
  const executed: { name: string; args: unknown; callId: string }[] = []
  const readResults: unknown[] = []
  const route0 = args.route === undefined ? { ...ROUTE } : args.route
  if (route0) routeCache.set(session.id, route0)
  const storePort = {
    getSnapshot: () => ({
      projectId: 'p1',
      nodes: [
        {
          id: 'img-1',
          projectId: 'p1',
          type: 'generation',
          parentId: null,
          x: 0,
          y: 0,
          w: 240,
          h: 180,
          title: '图一',
          disabled: false,
          data: {
            mode: 'image',
            prompt: '一只猫',
            assetHash: 'hash-1',
            assetMime: 'image/png',
            linkedPromptNodeIds: [],
            channelId: '',
            model: '',
            thumbOrder: [],
            upstreamHidden: [],
          },
        },
      ],
      edges: [],
    }),
    notify: vi.fn(),
  } as never
  const ports: AgentLoopAssemblyPorts = {
    store: storePort,
    channels: {
      getState: () => ({ channels: [] }),
      protocolCatalog: () => ({ protocols: [] } as never),
    } as never,
    platform: {
      storage: {} as never,
      assets: {} as never,
    },
    modelRoute: { plan: vi.fn() } as never,
    routeExecution: {
      execute: vi.fn(async (request: Record<string, unknown>) => {
        executions.push(request)
        if (typeof request.onRouteSucceeded === 'function') {
          ;(
            request.onRouteSucceeded as (
              selected: { channelId: string; model: string },
            ) => void
          )({
            channelId: 'channel-2',
            model: 'upstream-2',
          })
        }
        return {
          text: '',
          toolCalls: [],
        } as unknown as TextResult
      }),
    } as never,
    sessions: {
      get: vi.fn(async () => session),
    } as never,
    jobs: {
      active: vi.fn(async () => ({ id: 'job-1' })),
      appendEvent: vi.fn(async (id: string, type: string, payload?: unknown) => {
        events.push({ id, type, payload })
        return null
      }),
    } as never,
    reviewModel: '',
    canvasReviewEnabled: false,
    viewport: { x: 0, y: 0 },
    executeToolWithLedger: vi.fn(
      async (
        _sessionId: string,
        request: { callId: string; name: string; args: unknown },
        execute: () => Promise<unknown>,
      ) => {
        executed.push(request)
        if (
          request.name === 'applyPlan' &&
          args.applyPlanResult !== undefined
        ) {
          readResults.push(args.applyPlanResult)
          return args.applyPlanResult
        }
        const result = await execute()
        readResults.push(result)
        return result
      },
    ) as never,
    toolCtx: vi.fn(
      (() => ({ store: storePort })) as never,
    ) as never,
    abortSignalFor: () => undefined,
    nodeRunStates:
      (typeof args.nodeRunStates === 'function'
        ? args.nodeRunStates
        : () => args.nodeRunStates ?? new Map()) as never,
    cachedChatRoute: vi.fn((target: AgentSession) =>
      routeCache.get(target.id) ?? null,
    ) as never,
    commitChatRoute: vi.fn(
      (
        sessionId: string,
        expectedRoute: AgentChatRoute,
        route: AgentChatRoute,
      ) => {
        if (routeCache.get(sessionId) !== expectedRoute) return false
        routeCache.set(sessionId, route)
        return true
      },
    ) as never,
    contextTraceFor: () => undefined,
    planAliasesFor: (sessionId: string) =>
      planAliasesStore.get(sessionId),
    setPlanAliases: (
      sessionId: string,
      aliases: ReadonlyMap<string, string>,
    ) => {
      planAliasesStore.set(sessionId, aliases)
    },
    turnToolsFor: (sessionId: string) =>
      turnToolsStore.get(sessionId),
    setTurnTools: (sessionId: string, tools: readonly ToolDeclaration[]) => {
      turnToolsStore.set(sessionId, tools)
    },
    deliveredSteersFor: (sessionId: string) =>
      deliveredStore.get(sessionId) ?? new Set<string>(),
    setDeliveredSteers: (
      sessionId: string,
      ids: Set<string>,
    ) => {
      deliveredStore.set(sessionId, ids)
    },
    appendLiveProcessFor: vi.fn(),
    setLiveActivityFor: vi.fn(),
    setStatusFor: vi.fn((_id, status) => {
      statusUpdates.push(status)
    }) as never,
  }
  const deps = assembleAgentLoopDeps(ports, {
    session,
    operationId: 'op-1',
    toolMode: args.toolMode ?? 'native',
    visualNodeIds: ['img-1'],
    turnTools: args.turnTools ?? [tool('readGraph')],
    turnController: args.controller,
    abortSignalFor: () => undefined,
  })
  return {
    deps,
    ports,
    executions,
    statusUpdates,
    events,
    executed,
    readResults,
    routeCache,
    deliveredStore,
    planAliasesStore,
    turnToolsStore,
  }
}

const requestOf = (): TextRunRequest => ({
  kind: 'text',
  channelId: 'channel-1',
  model: 'upstream-1',
  prompt: '',
  inputs: [],
  params: {},
  messages: [],
})

describe('assembleAgentLoopDeps', () => {
  it('★★ native 带本轮工具集，json 模式下不向渠道声明 tools', async () => {
    const native = harness({ turnTools: [tool('readGraph')] })
    await native.deps.adapter.completeText(
      requestOf(),
      new AbortController().signal,
    )
    expect(native.executions[0]).toMatchObject({
      tools: [expect.objectContaining({ name: 'readGraph' })],
      modelIsUpstream: true,
      channelId: 'channel-1',
    })

    const json = harness({
      toolMode: 'json',
      turnTools: [tool('readGraph')],
    })
    await json.deps.adapter.completeText(
      requestOf(),
      new AbortController().signal,
    )
    expect(json.executions[0]).toMatchObject({ tools: [] })
  })

  it('★★ signal 使用回合创建时的 controller', () => {
    const controller = new AbortController()
    const h = harness({ controller })
    expect(h.deps.signal).toBe(controller.signal)
    const fallback = harness({})
    expect(fallback.deps.signal).toBeInstanceOf(AbortSignal)
  })

  it('★★ 成功候选写回缓存后，当前 route 立即使用新 channel/model', async () => {
    const h = harness({
      route: { ...ROUTE, candidates: [] },
    })
    await h.deps.adapter.completeText(
      requestOf(),
      new AbortController().signal,
    )
    expect(h.routeCache.get(session.id)).toMatchObject({
      channelId: 'channel-2',
      upstreamModel: 'upstream-2',
    })
    /** 命中回调后下一次请求不能继续走旧 route */
    await h.deps.adapter.completeText(
      requestOf(),
      new AbortController().signal,
    )
    expect(h.executions[1]).toMatchObject({
      channelId: 'channel-2',
      model: 'upstream-2',
    })
  })

  it('★★ discoverCapabilities 命中后写回本轮工具集，不重复加入', async () => {
    const h = harness({ turnTools: [tool('readGraph')] })
    const discovered = await h.deps.discoverCapabilities?.({
      query: '移动节点',
    })
    expect(discovered).toBeTruthy()
    const loaded = h.turnToolsStore.get(session.id) ?? []
    const names = loaded.map((item) => item.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('readGraph')
    expect(names.length).toBeGreaterThan(1)
  })

  it('★★ runNode 预检缺模型时拦下确认，proposeTaskPlan 非法计划被拦', () => {
    const h = harness({})
    const runNode = h.deps.precheck?.('runNode', {
      nodeIds: ['ref1'],
    })
    expect(runNode?.ok).toBe(false)
    const plan = h.deps.precheck?.('proposeTaskPlan', {
      title: '',
      steps: [],
    })
    expect(plan?.ok).toBe(false)
    expect(h.deps.precheck?.('readGraph', {})).toEqual({ ok: true })
  })

  it('★★ applyPlan 返回的 resolvedNodes 会写回 localId → nodeId 别名', async () => {
    const h = harness({
      applyPlanResult: {
        ok: true,
        problems: [],
        createdNodeIds: ['node-real'],
        resolvedNodes: [
          {
            localId: 'v1',
            nodeId: 'node-real',
            type: 'generation',
            created: true,
          },
        ],
      },
    })

    await h.deps.executeWrite(
      'applyPlan',
      { summary: '一个节点', nodes: [], edges: [] },
      'call-apply',
    )

    expect(h.planAliasesStore.get(session.id)).toEqual(
      new Map([['v1', 'node-real']]),
    )
  })

  it('★★ readResult 执行层失败会被转成可读失败原因', async () => {
    const failure = {
      kind: 'failed' as const,
      error: { kind: 'network', detail: 'timeout' },
    }
    const h = harness({
      nodeRunStates: new Map([['img-1', failure]]),
    })
    await h.deps.executeRead(
      'readResult',
      { nodeIds: ['img-1'] },
      'call-1',
    )
    expect(h.executed).toEqual([
      { callId: 'call-1', name: 'readResult', args: { nodeIds: ['img-1'] } },
    ])
    const results = h.readResults[0] as {
      results: { status: string; reason?: string }[]
    }
    expect(results.results[0]?.status).toBe('failed')
    expect(results.results[0]?.reason).toBe(
      describeError(failure.error as never),
    )
  })

  it('★★ readResult 无失败态时如实报 ok，不伪造失败', async () => {
    const h = harness({ nodeRunStates: new Map() })
    await h.deps.executeRead(
      'readResult',
      { nodeIds: ['img-1'] },
      'call-2',
    )
    const results = h.readResults[0] as {
      results: { status: string; reason?: string }[]
    }
    expect(results.results[0]?.status).toBe('ok')
    expect(results.results[0]?.reason).toBeUndefined()
  })

  it('★★ 旧 loopDeps 仍读取最新 nodeRunStates，不冻结 render 快照', async () => {
    let live = new Map<string, { kind: 'failed'; error: unknown }>()
    const h = harness({
      nodeRunStates: () => live,
    })

    live = new Map([[
      'img-1',
      {
        kind: 'failed',
        error: {
          kind: 'http',
          status: 500,
          body: '后台失败',
        },
      },
    ]])
    await h.deps.executeRead(
      'readResult',
      { nodeIds: ['img-1'] },
      'call-live',
    )

    const results = h.readResults[0] as {
      results: { status: string; reason?: string }[]
    }
    expect(results.results[0]).toMatchObject({
      status: 'failed',
      reason: expect.stringContaining('500'),
    })
  })

  it('★★ takeSteering 按已投递去重、写回并追加事件', async () => {
    const h = harness({ delivered: new Set(['steer-1']) })
    const messages = (await h.deps.takeSteering?.()) as ChatMessage[]
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toBe('先做这个')
    expect(h.events).toEqual([
      {
        id: 'job-1',
        type: 'steer_applied',
        payload: { steerId: 'steer-2', textLength: 4 },
      },
    ])
    expect([...(h.deliveredStore.get(session.id) ?? [])]).toEqual([
      'steer-1',
      'steer-2',
    ])
    /** 第二次不再重复投递 */
    const again = (await h.deps.takeSteering?.()) as ChatMessage[]
    expect(again).toHaveLength(0)
  })

  it('★★ 首次 takeSteering 没有 delivered entry 时创建并写回', async () => {
    const h = harness({})
    const messages = (await h.deps.takeSteering?.()) as ChatMessage[]
    expect(messages).toHaveLength(2)
    expect([...(h.deliveredStore.get(session.id) ?? [])]).toEqual([
      'steer-1',
      'steer-2',
    ])
  })

  it('★★ 视觉输入按节点引用收集，供各轮请求复用', () => {
    const h = harness({})
    const inputs = (h.deps.inputs ?? []) as NodeInput[]
    expect(inputs).toEqual([
      {
        kind: 'asset',
        nodeId: 'img-1',
        assetHash: 'hash-1',
        mime: 'image/png',
      },
    ])
  })
})
