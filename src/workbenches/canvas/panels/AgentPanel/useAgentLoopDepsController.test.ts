import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopDeps } from '../../agent/agentLoop'
import type {
  AgentLoopAssemblyPorts,
  AssembleAgentLoopInput,
} from './agentLoopDeps'
import {
  useAgentLoopDepsController,
  type AgentLoopDepsControllerInput,
  type AgentLoopDepsFor,
} from './useAgentLoopDepsController'

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

const toolA = { name: 'node.create', description: 'a', parameters: {} }
const toolB = { name: 'node.update', description: 'b', parameters: {} }

function harness(over: Partial<AgentLoopDepsControllerInput> = {}) {
  const calls: Array<{
    ports: AgentLoopAssemblyPorts
    input: AssembleAgentLoopInput
  }> = []
  const assembled = { marker: 'assembled' } as unknown as AgentLoopDeps
  const assemble = vi.fn(
    (ports: AgentLoopAssemblyPorts, input: AssembleAgentLoopInput) => {
      calls.push({ ports, input })
      return assembled
    },
  )
  const abortRefs = { current: new Map<string, AbortController>() }
  const contextTraceRef = { current: new Map() }
  const planAliasesRef = { current: new Map<string, Map<string, string>>() }
  const turnToolsRef = { current: new Map() }
  const deliveredSteersRef = { current: new Map<string, Set<string>>() }
  const nodeStates = { current: new Map<string, { kind: string }>() }
  const execution = {
    get nodeStates() {
      return nodeStates.current as never
    },
  }
  const platform = { storage: {}, assets: {} }
  const toolCtx = vi.fn()
  const input: AgentLoopDepsControllerInput = {
    store: { getSnapshot: vi.fn(), notify: vi.fn() } as never,
    channels: { getState: vi.fn(), protocolCatalog: vi.fn() } as never,
    platform: platform as never,
    modelRoute: { marker: 'modelRoute' } as never,
    routeExecution: { marker: 'routeExecution' } as never,
    sessions: { marker: 'sessions' } as never,
    jobs: { marker: 'jobs' } as never,
    reviewModel: 'vision-model',
    canvasReviewEnabled: true,
    viewport: { x: 11, y: 22 },
    executeToolWithLedger: vi.fn() as never,
    toolCtx: toolCtx as never,
    execution: execution as never,
    cachedChatRoute: vi.fn() as never,
    commitChatRoute: vi.fn() as never,
    abortRefs,
    contextTraceRef,
    planAliasesRef,
    turnToolsRef,
    deliveredSteersRef,
    appendLiveProcessFor: vi.fn() as never,
    setLiveActivityFor: vi.fn() as never,
    setStatusFor: vi.fn() as never,
    activeAgentTools: [toolA] as never,
    assemble: assemble as never,
    ...over,
  }
  return {
    input,
    calls,
    assembled,
    abortRefs,
    contextTraceRef,
    planAliasesRef,
    turnToolsRef,
    deliveredSteersRef,
    nodeStates,
    platform,
    toolCtx,
  }
}

function render(props: AgentLoopDepsControllerInput): {
  viewRef: { current: AgentLoopDepsFor | null }
  update: (next: AgentLoopDepsControllerInput) => void
} {
  const viewRef: { current: AgentLoopDepsFor | null } = { current: null }
  function Probe(next: AgentLoopDepsControllerInput) {
    viewRef.current = useAgentLoopDepsController(next)
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

describe('useAgentLoopDepsController / 输入透传', () => {
  it('session / operationId / turnController 原样进装配，默认值不变', () => {
    const h = harness()
    const { viewRef } = render(h.input)
    const target = session('s1')
    const controller = new AbortController()

    const result = viewRef.current!({
      session: target,
      operationId: 'op-1',
      turnController: controller,
    })

    expect(result).toBe(h.assembled)
    const input = h.calls[0]!.input
    expect(input.session).toBe(target)
    expect(input.operationId).toBe('op-1')
    expect(input.turnController).toBe(controller)
    expect(input.toolMode).toBe('native')
    expect(input.visualNodeIds).toEqual([])
    expect(input.turnTools).toBe(h.input.activeAgentTools)
    expect(input.onProgress).toBeUndefined()
  })

  it('显式参数覆盖默认（toolMode / turnTools / visualNodeIds / onProgress）', () => {
    const h = harness()
    const { viewRef } = render(h.input)
    const onProgress = vi.fn()

    viewRef.current!({
      session: session('s1'),
      operationId: 'op-2',
      toolMode: 'json',
      visualNodeIds: ['n1'],
      turnTools: [toolB] as never,
      onProgress,
    })

    const input = h.calls[0]!.input
    expect(input.toolMode).toBe('json')
    expect(input.visualNodeIds).toEqual(['n1'])
    expect(input.turnTools).toBe(input.turnTools)
    expect(input.turnTools).toEqual([toolB])
    expect(input.onProgress).toBe(onProgress)
  })

  it('装配端口原样透传，platform 只挑 storage / assets', () => {
    const h = harness()
    const { viewRef } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-3' })

    const ports = h.calls[0]!.ports
    expect(ports.store).toBe(h.input.store)
    expect(ports.channels).toBe(h.input.channels)
    expect(ports.jobs).toBe(h.input.jobs)
    expect(ports.sessions).toBe(h.input.sessions)
    expect(ports.modelRoute).toBe(h.input.modelRoute)
    expect(ports.routeExecution).toBe(h.input.routeExecution)
    expect(ports.executeToolWithLedger).toBe(
      h.input.executeToolWithLedger,
    )
    expect(ports.reviewModel).toBe('vision-model')
    expect(ports.canvasReviewEnabled).toBe(true)
    expect(ports.viewport).toBe(h.input.viewport)
    expect(ports.platform).toEqual({
      storage: h.platform.storage,
      assets: h.platform.assets,
    })
    // visualReview / nodeRunStateOf 由 assembleAgentLoopDeps 用这个 ctx 补上去：
    // toolCtx 一旦被包装成新函数，那两处补丁就丢了。
    expect(ports.toolCtx).toBe(h.input.toolCtx)
  })
})

describe('useAgentLoopDepsController / 取值时机（thunk 现取）', () => {
  it('contextTraceFor 每次调用现读 ref', () => {
    const h = harness()
    const { viewRef } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-1' })
    const ports = h.calls[0]!.ports

    expect(ports.contextTraceFor('s1')).toBeUndefined()
    const trace = { digest: 'd1', memoryRefs: [], kitVersionRefs: [], assetRefs: [] }
    h.contextTraceRef.current.set('s1', trace as never)
    expect(ports.contextTraceFor('s1')).toBe(trace)
  })

  it('turnToolsFor / setTurnTools 往返到 ref', () => {
    const h = harness()
    const { viewRef } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-1' })
    const ports = h.calls[0]!.ports

    expect(ports.turnToolsFor('s1')).toBeUndefined()
    ports.setTurnTools('s1', [toolB] as never)
    expect(ports.turnToolsFor('s1')).toEqual([toolB])
  })

  it('planAliasesFor / setPlanAliases 往返到 ref', () => {
    const h = harness()
    const { viewRef } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-1' })
    const ports = h.calls[0]!.ports
    const aliases = new Map([['local-1', 'node-1']])

    expect(ports.planAliasesFor('s1')).toBeUndefined()
    ports.setPlanAliases('s1', aliases)
    expect(ports.planAliasesFor('s1')).toBe(aliases)
  })

  it('deliveredSteersFor 无值时给新 Set，有值时给同一引用', () => {
    const h = harness()
    const { viewRef } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-1' })
    const ports = h.calls[0]!.ports

    const empty = ports.deliveredSteersFor('s1')
    expect(empty.size).toBe(0)
    ports.setDeliveredSteers('s1', new Set(['steer-1']))
    expect([...ports.deliveredSteersFor('s1')]).toEqual(['steer-1'])
  })

  it('abortSignalFor 用传入 controller 的信号，换 controller 后跟着换', () => {
    const h = harness()
    const { viewRef } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-1' })
    const ports = h.calls[0]!.ports
    const first = new AbortController()
    expect(ports.abortSignalFor('s1')).toBeUndefined()
    h.abortRefs.current.set('s1', first)
    expect(ports.abortSignalFor('s1')).toBe(first.signal)

    const second = new AbortController()
    h.abortRefs.current.set('s1', second)
    expect(ports.abortSignalFor('s1')).toBe(second.signal)
    // input 里那份回调也走同一个 ref（确认 / 继续入口靠它兜底）
    expect(h.calls[0]!.input.abortSignalFor('s1')).toBe(second.signal)
  })

  it('nodeRunStates 每次读取 execution 的当前 Map', () => {
    const h = harness()
    const { viewRef } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-1' })
    const ports = h.calls[0]!.ports

    expect(ports.nodeRunStates().size).toBe(0)
    h.nodeStates.current.set('n1', { kind: 'failed' })
    expect(ports.nodeRunStates().get('n1')).toEqual({ kind: 'failed' })
  })

  it('viewport 跟着渲染换：每次装配都拿到最新那份（origin 因此是"这次调用"的）', () => {
    const h = harness()
    const { viewRef, update } = render(h.input)

    viewRef.current!({ session: session('s1'), operationId: 'op-1' })
    expect(h.calls[0]!.ports.viewport).toEqual({ x: 11, y: 22 })

    const moved = { x: 100, y: 200 }
    update({ ...h.input, viewport: moved })
    viewRef.current!({ session: session('s1'), operationId: 'op-1' })

    // 不是建 hook 时冻住的那份；assemble 内部用它算 originOf(viewport)
    expect(h.calls[1]!.ports.viewport).toBe(moved)
  })
})
