import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import type { AgentTurnOrigin } from '../../../../features/shared/agent/AgentController'
import {
  claimSessionActivity,
  isSessionActivityActive,
  releaseSessionActivity,
} from '../../../../features/canvas/agent/sessionActivity'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentLoopDeps, AgentLoopOutcome } from '../../agent/agentLoop'
import { IDLE_STATUS } from './AgentActivityViews'
import {
  runAgentConfirmation,
  type AgentConfirmationRunInput,
} from './agentConfirmationRun'
import { useAgentQueueController } from './useAgentQueueController'

/**
 * #916 的**链路级**证据：确认收口失败时，内存活动锁到底有没有被释放。
 *
 * 单元测试（`agentConfirmationRun.test.ts`）只能证明「`settleSessionOutcome` 被调用了」；
 * 真正把锁放下的是它内部那句 `releaseSessionActivity`。所以这里接**真的**
 * `useAgentQueueController().settleSessionOutcome` 与**真的**全局活动锁，
 * 断言「收口之后还能重新领取这条会话」—— 这才是「永久 busy」有没有被治好的判据。
 */

const SESSION_ID = 'session-confirm'

const messages: ChatMessage[] = [
  { role: 'user', content: '运行这张图' },
  { role: 'assistant', content: '' },
]

const session: AgentSession = {
  id: SESSION_ID,
  projectId: 'p1',
  title: '确认执行',
  channelId: '',
  model: 'chat-model',
  queuedTurns: [],
  pendingSteers: [],
  messages,
  messageRevision: 7,
  createdAt: 1,
  updatedAt: 1,
}

const request: AgentToolRequest = {
  callId: 'call-run',
  name: 'runNode',
  args: { nodeIds: ['node-1'] },
}

/** 直接发送的确认（不是队列回合）：origin 里没有 queueTurnId */
const origin: AgentTurnOrigin = {
  jobId: 'job-1',
  turnId: 'turn-1',
  messageRevision: 7,
}

const resumed: AgentLoopOutcome = {
  kind: 'message',
  text: '已完成',
  messages,
}

/** 取真的 `settleSessionOutcome`（只有它能放下内存活动锁） */
function mountQueueSettlement() {
  const api: {
    settle: ReturnType<
      typeof useAgentQueueController
    >['settleSessionOutcome'] | null
  } = { settle: null }
  const currentIdRef = { current: null }
  const queuePumpingRef = { current: new Set<string>() }
  const queuePumpRef = { current: () => {} }
  const trackRun = <T,>(work: () => Promise<T>): Promise<T> => work()

  function Probe() {
    const queue = useAgentQueueController({
      current: null,
      currentIdRef,
      status: IDLE_STATUS,
      sessions: {} as never,
      controller: {} as never,
      sendText: async () => undefined,
      applySessionSnapshot: () => {},
      setStatusFor: () => {},
      setDraft: () => {},
      setQueueMenuId: () => {},
      refresh: async () => ({ applied: false, rows: [] }) as never,
      notify: () => {},
      queuePumpingRef,
      queuePumpRef,
      trackRun,
      saveDraft: () => {},
    })
    api.settle = queue.settleSessionOutcome
    return null
  }

  act(() => {
    TestRenderer.create(createElement(Probe))
  })
  return api
}

function harness(
  settleSessionOutcome: AgentConfirmationRunInput['settleSessionOutcome'],
  overrides: Partial<AgentConfirmationRunInput> = {},
): AgentConfirmationRunInput {
  const controller = new AbortController()
  const loopDeps = { signal: controller.signal } as AgentLoopDeps
  return {
    session,
    request,
    messages,
    turnOrigin: vi.fn(() => origin),
    beginConfirmation: vi.fn(async () => {}),
    finishConfirmedTool: vi.fn(async () => {}),
    executeConfirmedTool: vi.fn(async () => ({ ok: true })),
    ensureRoute: vi.fn(async () => ({
      ok: true as const,
      route: {} as never,
    })),
    createLoopDeps: vi.fn(() => loopDeps),
    toolMode: () => 'native',
    turnTools: () => [],
    resumeAgentTurn: vi.fn(async () => resumed),
    continueAutoConfirmations: vi.fn(async () => resumed),
    handleOutcome: vi.fn(async () => 'applied' as const),
    settleSessionOutcome,
    transitionSessionJob: vi.fn(async () => null),
    setAbortController: vi.fn(),
    setStatus: vi.fn(),
    isCurrentSession: () => true,
    setMessages: vi.fn(),
    createAbortController: () => controller,
    ...overrides,
  }
}

afterEach(() => {
  releaseSessionActivity(SESSION_ID)
})

describe('确认收口失败后的活动锁', () => {
  it('Job 转态抛错时活动锁仍被释放：收口之后还能重新领取这条会话', async () => {
    const queue = mountQueueSettlement()
    // 这一回合已经领到活动锁（正常情况下由发送流领取）
    expect(claimSessionActivity(SESSION_ID, origin.queueTurnId, origin.turnId)).toBe(
      true,
    )
    expect(isSessionActivityActive(SESSION_ID)).toBe(true)

    const input = harness(queue.settle!, {
      beginConfirmation: vi.fn(async () => {
        throw new Error('复核失败')
      }),
      transitionSessionJob: vi.fn(async () => {
        throw new Error('store 写失败')
      }),
    })

    const result = await runAgentConfirmation(input)

    expect(result).toBe('failed')
    // ★ 关键判据：锁放下了
    expect(isSessionActivityActive(SESSION_ID)).toBe(false)
    // ★ 用户视角判据：同一会话还能再发一次（否则就是永久 busy）
    expect(claimSessionActivity(SESSION_ID)).toBe(true)
  })

  it('对照组：转态正常时同样释放（证明这条链路本身没坏）', async () => {
    const queue = mountQueueSettlement()
    claimSessionActivity(SESSION_ID, origin.queueTurnId, origin.turnId)

    const input = harness(queue.settle!, {
      beginConfirmation: vi.fn(async () => {
        throw new Error('复核失败')
      }),
    })

    await runAgentConfirmation(input)

    expect(isSessionActivityActive(SESSION_ID)).toBe(false)
    expect(claimSessionActivity(SESSION_ID)).toBe(true)
  })
})
