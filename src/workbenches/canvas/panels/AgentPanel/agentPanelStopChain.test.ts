import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import type { QueuedAgentTurn } from '../../../../domain/agent/queuedTurn'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  claimSessionActivity,
  clearQueueDrain,
  isSessionActivityActive,
  queueTurnMatchesSessionActivity,
  releaseSessionActivity,
  turnMatchesSessionActivity,
} from '../../../../features/canvas/agent/sessionActivity'
import type { AgentPanelStatus } from './AgentActivityViews'
import { useAgentInterruptSettlementController } from './useAgentInterruptSettlementController'
import { useAgentPanelRefs, type AgentPanelRefs } from './useAgentPanelRefs'
import { useAgentStopController, type AgentStop } from './useAgentStopController'

const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true

/**
 * **停止按钮的整条链路**（行为级，不是单元级）。
 *
 * 门禁要的不是「`useAgentStopController` 调了 settle」，而是用户按下停止之后：
 * 正在跑的生成真的被 abort → 六张 per-session 表清空 → 活动锁释放 → 状态回 idle →
 * **排队任务还在** → 按钮能再按一次。
 *
 * 这条链横跨三层（stop 控制器 → 中断收口控制器 → 收口模块）与全局活动锁，
 * 任何一层换了顺序或漏清一张表，用户在界面上看到的就是「点了没反应」或
 * 「停了之后排队消息也没了」。
 */

const SESSION_ID = 's1'

function queued(id: string): QueuedAgentTurn {
  return {
    id,
    text: '再画一张',
    createdAt: 1,
    channelId: 'channel-frozen',
    model: 'Frozen Model',
  }
}

function session(): AgentSession {
  return {
    id: SESSION_ID,
    projectId: 'p1',
    title: '会话一',
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [queued('q1')],
    createdAt: 1,
    updatedAt: 1,
  }
}

/** 刚批准、正在执行的那次确认（比卡上那条新） */
const LIVE_REQUEST: AgentToolRequest = {
  callId: 'call-live',
  name: 'node.delete',
  args: {},
}
/** 确认卡上挂着的那条 request */
const CARD_REQUEST: AgentToolRequest = {
  callId: 'call-card',
  name: 'node.delete',
  args: {},
}

const STATUS: AgentPanelStatus = {
  kind: 'awaitingConfirm',
  request: CARD_REQUEST,
}

function mount() {
  const spies = {
    settleSession: vi.fn(async () => session()),
    transition: vi.fn(async () => null),
    removeSteers: vi.fn(async () => null),
    finishQueuedTurn: vi.fn(async () => null),
    applySnapshot: vi.fn(),
    setMessages: vi.fn(),
    setStatus: vi.fn(),
    clearLiveActivities: vi.fn(),
    clearLiveProcess: vi.fn(),
    clearRunTasks: vi.fn(),
    notify: vi.fn(),
  }
  const api: {
    stop: AgentStop | null
    refs: AgentPanelRefs | null
  } = { stop: null, refs: null }

  function Probe() {
    const refs = useAgentPanelRefs()
    const settleInterruptedSession = useAgentInterruptSettlementController({
      controller: {
        jobId: () => undefined,
        turnId: () => undefined,
        finishQueuedTurn: spies.finishQueuedTurn,
      },
      // 这次停止不是队列回合（队列里那条是**别的**待跑任务）
      activeQueueTurnOf: () => undefined,
      currentIdRef: { current: SESSION_ID },
      refs: {
        abort: refs.abortRefs,
        deliveredSteers: refs.deliveredSteersRef,
        inFlightConfirmation: refs.inFlightConfirmationRef,
        currentTurnId: refs.currentTurnIdRef,
        currentTurnJobId: refs.currentTurnJobIdRef,
        currentTurnRevision: refs.currentTurnRevisionRef,
      },
      isActivityActive: (sessionId) => isSessionActivityActive(sessionId),
      turnMatchesActivity: (sessionId, queueTurnId, turnId) =>
        turnMatchesSessionActivity(sessionId, queueTurnId, turnId),
      queueTurnMatchesActivity: (sessionId, queueTurnId) =>
        queueTurnMatchesSessionActivity(sessionId, queueTurnId),
      clearQueueDrain: (sessionId) => clearQueueDrain(sessionId),
      settleSession: spies.settleSession,
      transitionSessionJob: spies.transition,
      removeSteers: spies.removeSteers,
      releaseActivity: (sessionId, queueTurnId, turnId) =>
        releaseSessionActivity(sessionId, queueTurnId, turnId),
      applySessionSnapshot: spies.applySnapshot,
      setMessages: spies.setMessages,
      clearLiveActivities: spies.clearLiveActivities,
      clearLiveProcess: spies.clearLiveProcess,
      clearRunTasks: spies.clearRunTasks,
      setStatus: spies.setStatus,
      notify: spies.notify,
    })
    api.refs = refs
    api.stop = useAgentStopController({
      current: session(),
      status: STATUS,
      inFlightConfirmationRef: refs.inFlightConfirmationRef,
      stoppingRef: refs.stoppingRef,
      settleInterruptedSession,
      notify: spies.notify,
      trackRun: (work) => work(),
    })
    return null
  }

  act(() => {
    TestRenderer.create(createElement(Probe))
  })
  return { api, spies }
}

afterEach(() => {
  releaseSessionActivity(SESSION_ID)
  clearQueueDrain(SESSION_ID)
})

describe('停止按钮的整条链路', () => {
  it('abort → 六张表清空 → 状态回 idle → 排队项保留 → 按钮可再按', async () => {
    // 这一回合正在跑：活动锁由 (queueTurnId=undefined, turnId=turn-1) 持有
    claimSessionActivity(SESSION_ID, undefined, 'turn-1')
    const { api, spies } = mount()
    const refs = api.refs!

    const abort = new AbortController()
    refs.abortRefs.current.set(SESSION_ID, abort)
    refs.deliveredSteersRef.current.set(SESSION_ID, new Set(['steer-1']))
    refs.inFlightConfirmationRef.current.set(SESSION_ID, LIVE_REQUEST)
    refs.currentTurnIdRef.current.set(SESSION_ID, 'turn-1')
    refs.currentTurnJobIdRef.current.set(SESSION_ID, 'job-1')
    refs.currentTurnRevisionRef.current.set(SESSION_ID, 7)

    await act(async () => {
      await api.stop!()
    })

    // ① 先 abort：正在跑的生成必须真的停下来（否则继续扣费）
    expect(abort.signal.aborted).toBe(true)

    // ② 六张表一起清：少清 abort 旧信号继续生效；少清 steers / 确认表会让迟到的写入复活
    expect(refs.abortRefs.current.has(SESSION_ID)).toBe(false)
    expect(refs.deliveredSteersRef.current.has(SESSION_ID)).toBe(false)
    expect(refs.inFlightConfirmationRef.current.has(SESSION_ID)).toBe(false)
    expect(refs.currentTurnIdRef.current.has(SESSION_ID)).toBe(false)
    expect(refs.currentTurnJobIdRef.current.has(SESSION_ID)).toBe(false)
    expect(refs.currentTurnRevisionRef.current.has(SESSION_ID)).toBe(false)

    // ③ 活动锁释放 + 状态回 idle（用户看到的那一下「停了」）
    expect(isSessionActivityActive(SESSION_ID)).toBe(false)
    expect(spies.setStatus).toHaveBeenCalledWith(SESSION_ID, { kind: 'idle' })
    expect(spies.clearLiveActivities).toHaveBeenCalledTimes(1)
    expect(spies.clearLiveProcess).toHaveBeenCalledTimes(1)
    expect(spies.clearRunTasks).toHaveBeenCalledTimes(1)

    // ④ 收口对象是「正在跑的那次确认」（不是卡上那条），并带本回合 revision 作停止屏障
    expect(spies.settleSession).toHaveBeenCalledWith(
      SESSION_ID,
      LIVE_REQUEST,
      'interrupted',
      7,
    )
    expect(spies.transition).toHaveBeenCalledTimes(1)
    expect(spies.applySnapshot).toHaveBeenCalledTimes(1)

    // ⑤ 队列项保留：这次停止不是队列回合，不许把排队那条当已消费
    expect(spies.finishQueuedTurn).not.toHaveBeenCalled()
    expect(spies.notify).toHaveBeenCalledWith(
      '当前回合已停止，排队任务保留；可从队列手动继续',
      'info',
    )

    // ⑥ 停止锁已释放：按钮能再按一次（否则会「卡死」）
    expect(refs.stoppingRef.current.has(SESSION_ID)).toBe(false)
  })

  it('连点两次只收口一次（收口未完成时第二次直接被丢掉）', async () => {
    const { api, spies } = mount()
    let finish: (() => void) | null = null
    spies.settleSession.mockImplementation(
      () =>
        new Promise<AgentSession>((resolve) => {
          finish = () => resolve(session())
        }),
    )

    let first!: Promise<void>
    act(() => {
      first = api.stop!()
      void api.stop!()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(spies.settleSession).toHaveBeenCalledTimes(1)

    await act(async () => {
      finish?.()
      await first
    })
    expect(api.refs!.stoppingRef.current.has(SESSION_ID)).toBe(false)
  })
})
