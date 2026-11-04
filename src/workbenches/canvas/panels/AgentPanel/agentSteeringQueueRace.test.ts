import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import type { QueuedAgentTurn } from '../../../../domain/agent/queuedTurn'
import { createMemoryPlatform } from '../../../../platform/memory'
import {
  createAgentSessionStore,
  type AgentSessionStore,
} from '../../../../state/agent/sessionStore'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import { releaseSessionActivity } from '../../../../features/canvas/agent/sessionActivity'
import { createTaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import { useAgentQueueController } from './useAgentQueueController'
import { useAgentSteeringController } from './useAgentSteeringController'

/**
 * #914 的端到端标定（不是 mock 对 mock）。
 *
 * 复现真实时序：队列泵已经把一条 turn 的文本发出去（`sendText` 卡在网络里），
 * 此刻用户在队列面板上点「引导」——**同一条 turn**。
 *
 * 修前：promote 成功 ⇒ 同一句进 `pendingSteers`，等模型下一次动作前再注入一次
 * ⇒ 同一句话执行两遍、双倍扣费、历史两条相同用户消息。
 * 修后：promote 返回 `active` 被拒 ⇒ 只发一次、`pendingSteers` 干净、队列项仍在。
 */

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const TURN: QueuedAgentTurn = {
  id: 'turn-1',
  text: '再生成一张',
  createdAt: 1,
  channelId: 'c1',
  model: 'm1',
}

describe('#914 引导 × 在飞队列项', () => {
  const cleanups: string[] = []
  afterEach(() => {
    for (const id of cleanups.splice(0)) releaseSessionActivity(id)
  })

  it('★★ pump 卡在发送时点引导：被拒，消息只发一次、历史只有一条', async () => {
    const sessions: AgentSessionStore = createAgentSessionStore(
      createMemoryPlatform().storage,
    )
    const created = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const sessionId = created.id
    cleanups.push(sessionId)
    await sessions.enqueueTurn(sessionId, TURN)

    const lifecycle = createTaskLifecycle()
    const sendReached = deferred()
    const gate = deferred()
    const persisted: ChatMessage[] = []
    const sendText = vi.fn(async (raw: string) => {
      sendReached.resolve()
      await gate.promise
      persisted.push({ role: 'user', content: raw })
      await sessions.saveMessages(sessionId, [...persisted])
      return undefined
    })
    const notify = vi.fn()
    const statusFor = () => ({ kind: 'thinking' } as const)
    const applySessionSnapshot = vi.fn()

    /** 真实 store 的语义直接接进两个控制器，只把「渲染层」换成本测试。 */
    const controller = {
      enqueueTurn: sessions.enqueueTurn,
      removeQueuedTurn: sessions.removeQueuedTurn,
      editQueuedTurn: sessions.updateQueuedTurnText,
      claimNextQueuedTurn: sessions.claimNextQueuedTurn,
      finishQueuedTurn: sessions.finishActiveQueuedTurn,
    } as unknown as AgentController

    const queueInput = {
      current: created,
      currentIdRef: { current: sessionId },
      status: { kind: 'idle' } as const,
      sessions,
      controller,
      sendText,
      applySessionSnapshot,
      setStatusFor: vi.fn(),
      setDraft: vi.fn(),
      setQueueMenuId: vi.fn(),
      refresh: vi.fn(async () => ({ rows: [], applied: true })),
      notify,
      queuePumpingRef: { current: new Set<string>() },
      queuePumpRef: { current: vi.fn() },
      trackRun: lifecycle.track,
      saveDraft: vi.fn(),
    }
    const steeringInput = {
      current: created,
      statusFor,
      isCurrentSession: vi.fn(() => true),
      trackRun: lifecycle.track,
      queueText: vi.fn(async () => true),
      sendText,
      settleInterruptedSession: vi.fn(async () => ({})),
      removeQueuedTurn: sessions.removeQueuedTurn,
      promoteQueuedTurnToSteer: sessions.promoteQueuedTurnToSteer,
      enqueueSteer: sessions.enqueueSteer,
      getQueuedJob: vi.fn(async () => null),
      cancelQueuedJob: vi.fn(async () => undefined),
      applySessionSnapshot,
      setDraft: vi.fn(),
      writeDraftForSession: vi.fn(),
      setQueueMenuId: vi.fn(),
      notify,
    }

    const api: {
      queue: ReturnType<typeof useAgentQueueController> | null
      steering: ReturnType<typeof useAgentSteeringController> | null
    } = { queue: null, steering: null }
    function Probe() {
      api.queue = useAgentQueueController(queueInput)
      api.steering = useAgentSteeringController(steeringInput)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })
    expect(api.queue).not.toBeNull()

    // 1) 队列泵领取队首并进入 sendText（卡住）
    let pumping!: Promise<void>
    act(() => {
      pumping = api.queue!.resumeQueue()
    })
    await act(async () => {
      await sendReached.promise
    })
    const inFlight = await sessions.get(sessionId)
    expect(inFlight?.activeTurnId).toBe(TURN.id)

    // 2) 用户在「发送中」点这条队列项的引导
    await act(async () => {
      await api.steering!.guideQueuedTurn(TURN)
    })
    expect(notify).toHaveBeenCalledWith(
      '这条消息正在发送中，不能转成引导',
      'error',
    )
    const afterGuide = await sessions.get(sessionId)
    expect(afterGuide?.pendingSteers).toEqual([])
    expect(afterGuide?.queuedTurns.map((item) => item.id)).toEqual([TURN.id])

    // 3) 放行：消息只发一次，历史里只有一条相同的用户消息
    await act(async () => {
      gate.resolve()
      await pumping
    })
    await lifecycle.waitForIdle(500)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith(
      TURN.text,
      expect.anything(),
      expect.objectContaining({ queueTurnId: TURN.id }),
    )
    const userMessages = (await sessions.messagesFor(sessionId)).filter(
      (message) => message.role === 'user',
    )
    expect(userMessages.map((message) => message.content)).toEqual([
      TURN.text,
    ])
    expect((await sessions.get(sessionId))?.pendingSteers).toEqual([])
  })
})
