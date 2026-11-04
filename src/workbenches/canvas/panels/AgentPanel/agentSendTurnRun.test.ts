import { describe, expect, it, vi } from 'vitest'
import type { AgentLoopDeps, AgentLoopOutcome } from '../../agent/agentLoop'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { PersistedAgentUserTurn } from './agentTurnPersistence'
import type {
  AgentPrepareArgs,
  AgentSendTurnPorts,
  AgentSendTurnRefs,
  AgentSendTurnUi,
} from './agentSendTurnRun'
import { runAgentSendTurn } from './agentSendTurnRun'
import type {
  AgentTurnRequestPreparation,
  PreparedAgentTurnRequest,
} from './agentTurnRequest'

function session(
  id = 's1',
  patch: Partial<AgentSession> = {},
): AgentSession {
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
    ...patch,
  }
}

const persisted: PersistedAgentUserTurn = {
  modelWindow: [],
  userMessage: { role: 'user', content: '画一张海报' },
  historyMessages: [{ role: 'user', content: '画一张海报' }],
  outcomeTailIndex: 0,
  saved: session('s1'),
  messageRevision: 7,
}

const OUTCOME: AgentLoopOutcome = {
  kind: 'message',
  text: 'ok',
  messages: [{ role: 'assistant', content: 'ok' }],
}

const DEPS = {} as AgentLoopDeps

/**
 * 只填发送主体真正会读的字段；chatRoute / promptProfile 等由 prepare 内部使用，
 * 这里用类型断言补齐，避免把无关的构造搬进测试。
 */
function ready(
  patch: Partial<PreparedAgentTurnRequest> = {},
): AgentTurnRequestPreparation {
  return {
    kind: 'ready',
    operationId: 'op-1',
    persistedTurn: persisted,
    visualNodeIds: ['node-1'],
    contextTrace: null,
    explicitMediaModels: { image: 'm-img' },
    perImage: true,
    toolMode: 'native',
    turnTools: [],
    systemPrompt: 'SYSTEM',
    ...patch,
  } as unknown as AgentTurnRequestPreparation
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface Harness {
  ports: AgentSendTurnPorts
  events: string[]
  refs: AgentSendTurnRefs
  ui: AgentSendTurnUi
  turnAbort: AbortController
  input: Parameters<typeof runAgentSendTurn>[0]
}

function harness(options: {
  session?: AgentSession
  prepare?: (args: AgentPrepareArgs) => Promise<AgentTurnRequestPreparation>
  turnAbort?: AbortController
} = {}): Harness {
  const events: string[] = []
  const target = options.session ?? session('s1')
  const turnAbort = options.turnAbort ?? new AbortController()
  const refs: AgentSendTurnRefs = {
    currentTurnJobId: { current: new Map<string, string>() },
    currentTurnId: { current: new Map<string, string>() },
    currentTurnRevision: { current: new Map<string, number>() },
    abort: { current: new Map<string, AbortController>() },
    contextTrace: { current: new Map() },
    toolMode: { current: new Map() },
    explicitMediaModels: { current: new Map() },
    turnTools: { current: new Map() },
  }
  refs.currentTurnJobId.current.set(target.id, 'job-old')
  const ui: AgentSendTurnUi = {
    currentIdRef: { current: target.id },
    setList: vi.fn(),
    setCurrent: vi.fn(),
    setDraft: vi.fn(),
    writeDraftForSession: vi.fn(),
    setMessages: vi.fn(),
    setStatusFor: vi.fn((_id, status) => {
      events.push(status.kind === 'thinking' ? 'thinking' : status.kind)
    }),
    clearLiveActivities: vi.fn(() => {
      events.push('live')
    }),
    clearLiveProcess: vi.fn(() => {
      events.push('process')
    }),
    clearRunTasks: vi.fn(() => {
      events.push('tasks')
    }),
    clearReveal: vi.fn(),
    setPerImage: vi.fn(() => {
      events.push('setPerImage')
    }),
  }
  const defaultPrepare = async ({ hooks }: AgentPrepareArgs) => {
    events.push('prepare')
    hooks.onPersisted(persisted)
    await hooks.onRouteReady('op-1')
    return ready()
  }
  const ports: AgentSendTurnPorts = {
    trackRun: (work) => work(),
    updateSessionFields: vi.fn(async () => {
      events.push('updateFields')
      return null
    }),
    failTurn: vi.fn(async () => {
      events.push('failTurn')
    }),
    prepare: vi.fn(options.prepare ?? defaultPrepare),
    ensureJob: vi.fn(async () => {
      events.push('ensureJob')
      return { id: 'job-1' }
    }),
    transition: vi.fn(async () => {
      events.push('transition')
      return null
    }),
    loopDeps: vi.fn(() => {
      events.push('loopDeps')
      return DEPS
    }),
    runTurn: vi.fn(async () => {
      events.push('runTurn')
      return OUTCOME
    }),
    continueAutoConfirmations: vi.fn(async (_session, initial) => {
      events.push('continue')
      return initial
    }),
    handleOutcome: vi.fn(async () => {
      events.push('handleOutcome')
    }),
    bindTurnToSessionActivity: vi.fn(() => true),
    syncAutoRunFromSession: vi.fn(),
    refs,
    ui,
  }
  return {
    ports,
    events,
    refs,
    ui,
    turnAbort,
    input: {
      text: '画一张海报',
      session: target,
      queueTurnId: undefined,
      internalControl: false,
      actualTurnId: 'turn-1',
      turnAbort,
    },
  }
}

describe('A-5 #1 / #2：prepare 之前必须先做的两件事', () => {
  it('#1 清 currentTurnJobIdRef 在 prepare 之前，且中间没有 await', async () => {
    const h = harness()
    let seenJobAtPrepare: boolean | undefined
    h.ports.prepare = vi.fn(async ({ hooks }) => {
      seenJobAtPrepare = h.refs.currentTurnJobId.current.has('s1')
      hooks.onPersisted(persisted)
      await hooks.onRouteReady('op-1')
      return ready()
    })

    await runAgentSendTurn(h.input, h.ports)

    // prepare 进入时旧 jobId 已经不在了……
    expect(seenJobAtPrepare).toBe(false)
    // ……而 onRouteReady 建完 Job 之后又写回去了，说明"先删后建"的顺序成立。
    expect(h.refs.currentTurnJobId.current.get('s1')).toBe('job-1')
  })

  it('#2 计划已完成 → 在 prepare 之前清掉并写 undefined', async () => {
    const plan = {
      id: 'plan-1',
      title: '计划',
      steps: [{ id: 'step-1', title: '出图', status: 'done' as const }],
      createdAt: 1,
      updatedAt: 1,
    }
    const h = harness({ session: session('s1', { taskPlan: plan }) })

    await runAgentSendTurn(h.input, h.ports)

    expect(h.ports.updateSessionFields).toHaveBeenCalledWith('s1', {
      taskPlan: undefined,
    })
    expect(h.events.indexOf('updateFields')).toBeLessThan(
      h.events.indexOf('prepare'),
    )
  })

  it('#2 计划进行中 / 没有计划 → 不清、不写库', async () => {
    const active = harness({
      session: session('s1', {
        taskPlan: {
          id: 'plan-1',
          title: '计划',
          steps: [
            { id: 'step-1', title: '出图', status: 'pending' as const },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    })
    const none = harness()

    await runAgentSendTurn(active.input, active.ports)
    await runAgentSendTurn(none.input, none.ports)

    expect(active.ports.updateSessionFields).not.toHaveBeenCalled()
    expect(none.ports.updateSessionFields).not.toHaveBeenCalled()
  })
})

describe('A-5 #3 / #4 / #5 / #6 / #9：保存与准备之间的顺序', () => {
  it('#3 onPersisted 的 UI/ref 写先于 onRouteReady 的建 Job', async () => {
    const h = harness()

    await runAgentSendTurn(h.input, h.ports)

    expect(h.events.indexOf('thinking')).toBeLessThan(
      h.events.indexOf('ensureJob'),
    )
    expect(h.events.indexOf('ensureJob')).toBeLessThan(
      h.events.indexOf('transition'),
    )
  })

  it('#4 五个 ref 必须在 loopDeps 之前写好', async () => {
    const h = harness()
    let seen: Record<string, unknown> = {}
    h.ports.loopDeps = vi.fn(() => {
      h.events.push('loopDeps')
      seen = {
        trace: h.refs.contextTrace.current.get('s1'),
        toolMode: h.refs.toolMode.current.get('s1'),
        explicit: h.refs.explicitMediaModels.current.get('s1'),
        turnTools: h.refs.turnTools.current.get('s1'),
      }
      return DEPS
    })

    await runAgentSendTurn(h.input, h.ports)

    expect(seen.toolMode).toBe('native')
    expect(seen.explicit).toEqual({ image: 'm-img' })
    expect(seen.turnTools).toEqual([])
    // contextTrace 为 null 时显式 delete，读回来必须是 undefined
    expect(seen.trace).toBeUndefined()
    // perImage 也要在 loopDeps 之前落地
    expect(h.events.indexOf('setPerImage')).toBeLessThan(
      h.events.indexOf('loopDeps'),
    )
  })

  it('#5 / #6 loopDeps → runTurn → continueAutoConfirmations → handleOutcome', async () => {
    const h = harness()

    const outcome = await runAgentSendTurn(h.input, h.ports)

    expect(h.events).toEqual([
      'prepare',
      'live',
      'process',
      'tasks',
      'thinking',
      'ensureJob',
      'transition',
      'setPerImage',
      'loopDeps',
      'runTurn',
      'continue',
      'handleOutcome',
    ])
    expect(outcome).toBe(OUTCOME)
    expect(h.ports.continueAutoConfirmations).toHaveBeenCalledWith(
      h.input.session,
      OUTCOME,
      DEPS,
      expect.any(Function),
    )
    expect(h.ports.handleOutcome).toHaveBeenCalledWith(
      h.input.session,
      OUTCOME,
      persisted,
      h.turnAbort,
    )
  })

  it('#9 abortRefs.set 先于 setStatusFor(thinking)', async () => {
    const h = harness()
    let abortAtThinking: AbortController | undefined
    h.ui.setStatusFor = vi.fn((_id, status) => {
      if (status.kind === 'thinking') {
        abortAtThinking = h.refs.abort.current.get('s1')
      }
    })

    await runAgentSendTurn(h.input, h.ports)

    expect(abortAtThinking).toBe(h.turnAbort)
  })
})

describe('A-5 #7 / #8 / #10：失败、措手不及与收口', () => {
  it('#7 failed 分支：failTurn → 三清 → setStatus，且不进模型', async () => {
    const h = harness({
      prepare: async () => ({
        kind: 'failed',
        message: '上下文准备失败',
        phase: 'tool_probe',
        persistedTurn: persisted,
        contextTrace: null,
      }),
    })

    const outcome = await runAgentSendTurn(h.input, h.ports)

    expect(outcome).toBeUndefined()
    expect(h.events).toEqual([
      'failTurn',
      'live',
      'process',
      'tasks',
      'error',
    ])
    expect(h.ports.failTurn).toHaveBeenCalledWith('s1', {
      reason: '上下文准备失败',
      phase: 'tool_probe',
      aborted: false,
      origin: { turnId: 'turn-1', queueTurnId: undefined },
    })
    expect(h.ports.runTurn).not.toHaveBeenCalled()
  })

  it('#8 routeReady 先置位：ensureJob 抛错必须冒泡而不是被吞成 error 状态', async () => {
    const h = harness()
    h.ports.ensureJob = vi.fn(async () => {
      throw new Error('job failed')
    })

    await expect(runAgentSendTurn(h.input, h.ports)).rejects.toThrow(
      'job failed',
    )
    expect(h.ports.runTurn).not.toHaveBeenCalled()
    expect(h.ui.setStatusFor).not.toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ kind: 'error' }),
    )
  })

  it('#10 handleOutcome 没结束前不许把 outcome 交回调用方', async () => {
    const h = harness()
    const gate = deferred<void>()
    h.ports.handleOutcome = vi.fn(() => gate.promise)

    let settled = false
    const run = runAgentSendTurn(h.input, h.ports).then((value) => {
      settled = true
      return value
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    gate.resolve()
    await expect(run).resolves.toBe(OUTCOME)
  })
})

describe('三个卡点', () => {
  it('卡点 A：prepare 未返回就 abort → 静默返回，不写 error 状态', async () => {
    const h = harness()
    const gate = deferred<AgentTurnRequestPreparation>()
    h.ports.prepare = vi.fn(() => gate.promise)

    const run = runAgentSendTurn(h.input, h.ports)
    h.turnAbort.abort()
    gate.reject(new Error('aborted during prepare'))

    await expect(run).resolves.toBeUndefined()
    expect(h.ui.setStatusFor).not.toHaveBeenCalled()
    expect(h.ports.runTurn).not.toHaveBeenCalled()
  })

  it('卡点 B：活动锁 CAS 抛错 → 冒泡到 prepare 回滚，runAgentTurn 零调用', async () => {
    const h = harness()
    let caught: unknown
    h.ports.bindTurnToSessionActivity = vi.fn(() => false)
    h.ports.prepare = vi.fn(async ({ hooks }) => {
      try {
        hooks.onPersisted(persisted)
        await hooks.onRouteReady('op-1')
        return ready()
      } catch (error) {
        caught = error
        throw error
      }
    })

    const outcome = await runAgentSendTurn(h.input, h.ports)

    expect(outcome).toBeUndefined()
    expect((caught as Error).message).toBe('会话活动锁已被其他回合占用')
    expect(h.ports.ensureJob).not.toHaveBeenCalled()
    expect(h.ports.runTurn).not.toHaveBeenCalled()
    expect(h.ui.setStatusFor).toHaveBeenCalledWith('s1', {
      kind: 'error',
      message: '用户消息或路由准备失败：会话活动锁已被其他回合占用',
    })
  })

  it('卡点 C：onRouteReady 之后抛错 → 必须 reject，不能被吞', async () => {
    const h = harness()
    h.ports.prepare = vi.fn(async ({ hooks }) => {
      hooks.onPersisted(persisted)
      await hooks.onRouteReady('op-1')
      throw new Error('after-route')
    })

    await expect(runAgentSendTurn(h.input, h.ports)).rejects.toThrow(
      'after-route',
    )
    expect(h.ports.runTurn).not.toHaveBeenCalled()
    // 只写过 thinking，没有把 error 状态糊上去
    expect(h.ui.setStatusFor).toHaveBeenCalledTimes(1)
    expect(h.ui.setStatusFor).toHaveBeenCalledWith('s1', {
      kind: 'thinking',
    })
  })
})

describe('早退分支', () => {
  it('aborted_before_job → 直接返回，不动 UI、不进模型', async () => {
    const h = harness({
      prepare: async () => ({
        kind: 'aborted_before_job',
        persistedTurn: persisted,
      }),
    })

    await expect(runAgentSendTurn(h.input, h.ports)).resolves.toBeUndefined()
    expect(h.ui.setStatusFor).not.toHaveBeenCalled()
    expect(h.ports.runTurn).not.toHaveBeenCalled()
  })

  it('route_failed → 用准备阶段给的文案写 error 状态，不进模型', async () => {
    const h = harness({
      prepare: async () => ({
        kind: 'route_failed',
        persistedTurn: persisted,
        message: '渠道不可用',
      }),
    })

    await expect(runAgentSendTurn(h.input, h.ports)).resolves.toBeUndefined()
    expect(h.ui.setStatusFor).toHaveBeenCalledWith('s1', {
      kind: 'error',
      message: '渠道不可用',
    })
    expect(h.ports.runTurn).not.toHaveBeenCalled()
  })
})
