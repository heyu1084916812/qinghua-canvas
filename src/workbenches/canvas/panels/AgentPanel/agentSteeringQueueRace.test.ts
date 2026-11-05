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
import {
  clearQueueDrain,
  releaseSessionActivity,
  requestQueueDrain,
} from '../../../../features/canvas/agent/sessionActivity'
import { createTaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import { useAgentQueueController } from './useAgentQueueController'
import { useAgentSteeringController } from './useAgentSteeringController'

/**
 * #914 的端到端标定（不是 mock 对 mock）。
 *
 * 复现真实时序：队列泵已经把一条 turn 的文本发出去（`sendText` 卡在网络里），
 * 此刻用户在队列面板上点「引导」——**同一条 turn**。
 *
 * 修前：活动项仍留在等待队列，promote 还能成功 ⇒ 同一句话执行两遍、双倍扣费。
 * 修后：claim 原子把活动项移出等待队列；迟到 promote 返回 `active` 被拒。
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
    for (const id of cleanups.splice(0)) {
      clearQueueDrain(id)
      releaseSessionActivity(id)
    }
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
    expect(inFlight?.activeTurn).toMatchObject({ id: TURN.id })
    expect(inFlight?.queuedTurns).toEqual([])

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
    expect(afterGuide?.queuedTurns).toEqual([])
    expect(afterGuide?.activeTurn).toMatchObject({ id: TURN.id })

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

  it('★★ A/B 快速切换时各自只领取自己的队首，不串队', async () => {
    const sessions: AgentSessionStore = createAgentSessionStore(
      createMemoryPlatform().storage,
    )
    const a = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const b = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    cleanups.push(a.id, b.id)
    await sessions.enqueueTurn(a.id, { ...TURN, id: 'turn-a', text: 'A 的消息' })
    await sessions.enqueueTurn(b.id, { ...TURN, id: 'turn-b', text: 'B 的消息' })

    const sent: Array<{
      text: string
      sessionId: string
      queueTurnId?: string
    }> = []
    const sendText = vi.fn(
      async (
        text: string,
        queuedSession?: { id: string },
        opts?: { queueTurnId?: string },
      ) => {
        sent.push({
          text,
          sessionId: queuedSession?.id ?? '',
          queueTurnId: opts?.queueTurnId,
        })
        return undefined
      },
    )
    const lifecycle = createTaskLifecycle()
    const queueInput = {
      current: a,
      currentIdRef: { current: a.id },
      status: { kind: 'idle' } as const,
      sessions,
      controller: {
        enqueueTurn: sessions.enqueueTurn,
        removeQueuedTurn: sessions.removeQueuedTurn,
        editQueuedTurn: sessions.updateQueuedTurnText,
        claimNextQueuedTurn: sessions.claimNextQueuedTurn,
        finishQueuedTurn: sessions.finishActiveQueuedTurn,
      } as unknown as AgentController,
      sendText,
      applySessionSnapshot: vi.fn(),
      setStatusFor: vi.fn(),
      setDraft: vi.fn(),
      setQueueMenuId: vi.fn(),
      refresh: vi.fn(async () => ({ rows: [a, b], applied: true })),
      notify: vi.fn(),
      queuePumpingRef: { current: new Set<string>() },
      queuePumpRef: { current: vi.fn() },
      trackRun: lifecycle.track,
      saveDraft: vi.fn(),
    }
    function Probe() {
      useAgentQueueController(queueInput)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    requestQueueDrain(a.id)
    requestQueueDrain(b.id)
    act(() => {
      queueInput.queuePumpRef.current(a.id)
      queueInput.queuePumpRef.current(b.id)
    })
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(2))

    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'A 的消息',
          sessionId: a.id,
          queueTurnId: 'turn-a',
        }),
        expect.objectContaining({
          text: 'B 的消息',
          sessionId: b.id,
          queueTurnId: 'turn-b',
        }),
      ]),
    )
    const [savedA, savedB] = await Promise.all([
      sessions.get(a.id),
      sessions.get(b.id),
    ])
    expect(savedA).toMatchObject({
      activeTurnId: 'turn-a',
      activeTurn: { id: 'turn-a' },
      queuedTurns: [],
    })
    expect(savedB).toMatchObject({
      activeTurnId: 'turn-b',
      activeTurn: { id: 'turn-b' },
      queuedTurns: [],
    })
  })

  it('★★ 入队转引导成功只保留一条，重复点击不再发送', async () => {
    const sessions: AgentSessionStore = createAgentSessionStore(
      createMemoryPlatform().storage,
    )
    const created = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    cleanups.push(created.id)
    await sessions.enqueueTurn(created.id, TURN)
    const sendText = vi.fn(async () => undefined)
    const notify = vi.fn()
    const steeringInput = {
      current: created,
      statusFor: () => ({ kind: 'thinking' } as const),
      isCurrentSession: vi.fn(() => true),
      trackRun: createTaskLifecycle().track,
      queueText: vi.fn(async () => true),
      sendText,
      settleInterruptedSession: vi.fn(async () => ({})),
      removeQueuedTurn: sessions.removeQueuedTurn,
      promoteQueuedTurnToSteer: sessions.promoteQueuedTurnToSteer,
      enqueueSteer: sessions.enqueueSteer,
      getQueuedJob: vi.fn(async () => null),
      cancelQueuedJob: vi.fn(async () => undefined),
      applySessionSnapshot: vi.fn(),
      setDraft: vi.fn(),
      writeDraftForSession: vi.fn(),
      setQueueMenuId: vi.fn(),
      notify,
    }
    let api: ReturnType<typeof useAgentSteeringController> | null = null
    function Probe() {
      api = useAgentSteeringController(steeringInput)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    await act(async () => {
      await api!.guideQueuedTurn(TURN)
    })
    await act(async () => {
      await api!.guideQueuedTurn(TURN)
    })

    const saved = await sessions.get(created.id)
    expect(saved?.queuedTurns).toEqual([])
    expect(saved?.pendingSteers).toEqual([
      expect.objectContaining({ id: expect.any(String), text: TURN.text }),
    ])
    expect(sendText).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      '已转为引导，将在 Agent 下一次动作前应用',
      'info',
    )
  })

  it('★★ 转引导失败时队列原样保留一次', async () => {
    const sessions: AgentSessionStore = createAgentSessionStore(
      createMemoryPlatform().storage,
    )
    const created = await sessions.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    cleanups.push(created.id)
    await sessions.enqueueTurn(created.id, TURN)
    for (let index = 0; index < 20; index += 1) {
      await sessions.enqueueSteer(created.id, {
        id: `steer-${index}`,
        text: `已有引导 ${index}`,
        createdAt: index,
      })
    }
    const notify = vi.fn()
    const steeringInput = {
      current: created,
      statusFor: () => ({ kind: 'thinking' } as const),
      isCurrentSession: vi.fn(() => true),
      trackRun: createTaskLifecycle().track,
      queueText: vi.fn(async () => true),
      sendText: vi.fn(async () => undefined),
      settleInterruptedSession: vi.fn(async () => ({})),
      removeQueuedTurn: sessions.removeQueuedTurn,
      promoteQueuedTurnToSteer: sessions.promoteQueuedTurnToSteer,
      enqueueSteer: sessions.enqueueSteer,
      getQueuedJob: vi.fn(async () => null),
      cancelQueuedJob: vi.fn(async () => undefined),
      applySessionSnapshot: vi.fn(),
      setDraft: vi.fn(),
      writeDraftForSession: vi.fn(),
      setQueueMenuId: vi.fn(),
      notify,
    }
    let api: ReturnType<typeof useAgentSteeringController> | null = null
    function Probe() {
      api = useAgentSteeringController(steeringInput)
      return null
    }
    act(() => {
      TestRenderer.create(createElement(Probe))
    })

    await act(async () => {
      await api!.guideQueuedTurn(TURN)
    })

    const saved = await sessions.get(created.id)
    expect(saved?.queuedTurns.map((turn) => turn.id)).toEqual([TURN.id])
    expect(saved?.pendingSteers).toHaveLength(20)
    expect(notify).toHaveBeenCalledWith('当前任务的引导已达上限', 'error')
  })
})
