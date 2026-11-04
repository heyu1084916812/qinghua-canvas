import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  claimSessionActivity,
  clearQueueDrain,
  isSessionActivityActive,
  releaseSessionActivity,
  requestQueueDrain,
  shouldDrainQueue,
} from '../../../../features/canvas/agent/sessionActivity'
import {
  useAgentQueueController,
  type AgentQueueControllerInput,
} from './useAgentQueueController'
import {
  TaskLifecycleClosedError,
  TaskLifecycleTimeoutError,
  createTaskLifecycle,
} from '../../../../features/shared/lifecycle/taskLifecycle'

const session: AgentSession = {
  id: 'session-1',
  projectId: 'project-1',
  title: '会话一',
  channelId: 'channel-1',
  model: 'GPT-6 Astra',
  imageModel: 'GPT Image 2',
  videoModel: '',
  messages: [],
  pendingSteers: [],
  queuedTurns: [],
  pendingAssetIds: ['node-1'],
  createdAt: 1,
  updatedAt: 1,
}

function input(
  patch: Partial<AgentQueueControllerInput> = {},
): AgentQueueControllerInput {
  const lifecycle = createTaskLifecycle()
  return {
    current: session,
    currentIdRef: { current: session.id },
    status: { kind: 'idle' },
    sessions: {
      get: vi.fn(async () => session),
    } as unknown as AgentQueueControllerInput['sessions'],
    controller: {
      enqueueTurn: vi.fn(async () => ({
        ok: true,
        session: { ...session, queuedTurns: [] },
      })),
      removeQueuedTurn: vi.fn(async () => session),
      editQueuedTurn: vi.fn(async () => session),
      claimNextQueuedTurn: vi.fn(async () => null),
      finishQueuedTurn: vi.fn(async () => session),
    } as unknown as AgentController,
    sendText: vi.fn(async () => undefined),
    applySessionSnapshot: vi.fn(),
    setStatusFor: vi.fn(),
    setDraft: vi.fn(),
    setQueueMenuId: vi.fn(),
    refresh: vi.fn(async () => ({ rows: [session], applied: true })),
    notify: vi.fn(),
    queuePumpingRef: { current: new Set<string>() },
    queuePumpRef: { current: vi.fn() },
    trackRun: (work) => lifecycle.track(work),
    saveDraft: vi.fn(),
    ...patch,
  }
}

describe('useAgentQueueController', () => {
  afterEach(() => {
    releaseSessionActivity(session.id)
    clearQueueDrain(session.id)
  })

  it('排队时冻结会话模型与附件快照', async () => {
    let api: ReturnType<typeof useAgentQueueController> | null = null
    const props = input()

    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }

    renderToStaticMarkup(createElement(Probe))
    expect(api).not.toBeNull()
    expect(await api!.queueText('  再生成一张  ')).toBe(true)

    expect(props.controller.enqueueTurn).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        text: '再生成一张',
        channelId: 'channel-1',
        model: 'GPT-6 Astra',
        imageModel: 'GPT Image 2',
        pendingAssetIds: ['node-1'],
      }),
    )
    // #930：无参数的 toHaveBeenCalled() 换个会话快照进来也绿；钉住是"刚入队的那份"
    expect(props.applySessionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: session.id, queuedTurns: [] }),
    )
  })

  it('没有对话模型时拒绝排队并给出明确状态', async () => {
    let api: ReturnType<typeof useAgentQueueController> | null = null
    const props = input({
      current: { ...session, model: '' },
      sessions: {
        get: vi.fn(async () => ({ ...session, model: '' })),
      } as unknown as AgentQueueControllerInput['sessions'],
    })

    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }

    renderToStaticMarkup(createElement(Probe))
    expect(await api!.queueText('排队')).toBe(false)
    expect(props.setStatusFor).toHaveBeenCalledWith(session.id, {
      kind: 'error',
      message: '还没选模型：先在上面选一个对话模型',
    })
    expect(props.controller.enqueueTurn).not.toHaveBeenCalled()
  })

  it('★★ 旧回合 settlement 不得销掉新队列或释放新活动锁', async () => {
    let api: ReturnType<typeof useAgentQueueController> | null = null
    const finishQueuedTurn = vi.fn(async () => session)
    const props = input({
      controller: {
        finishQueuedTurn,
      } as unknown as AgentController,
    })

    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }

    renderToStaticMarkup(createElement(Probe))
    expect(
      claimSessionActivity(session.id, 'turn-new', 'turn-new'),
    ).toBe(true)

    await api!.settleSessionOutcome(
      session.id,
      { kind: 'message', text: '完成', messages: [] },
      { queueTurnId: 'turn-old', turnId: 'turn-old' },
    )

    expect(finishQueuedTurn).not.toHaveBeenCalled()
    expect(isSessionActivityActive(session.id)).toBe(true)
  })

  it('★ originating queue + turn 完全匹配时才销队并释放', async () => {
    let api: ReturnType<typeof useAgentQueueController> | null = null
    const next = { ...session, queuedTurns: [] }
    const finishQueuedTurn = vi.fn(async () => next)
    const applySessionSnapshot = vi.fn()
    const props = input({
      controller: {
        finishQueuedTurn,
      } as unknown as AgentController,
      applySessionSnapshot,
    })

    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }

    renderToStaticMarkup(createElement(Probe))
    expect(
      claimSessionActivity(session.id, 'turn-1', 'turn-1'),
    ).toBe(true)

    await api!.settleSessionOutcome(
      session.id,
      { kind: 'message', text: '完成', messages: [] },
      { queueTurnId: 'turn-1', turnId: 'turn-1' },
    )

    expect(finishQueuedTurn).toHaveBeenCalledWith(
      session.id,
      'turn-1',
      true,
    )
    expect(applySessionSnapshot).toHaveBeenCalledWith(next)
    expect(isSessionActivityActive(session.id)).toBe(false)
  })

  /**
   * #929-②：`confirm` 与「检查点暂停」**不许放锁**。
   *
   * 放锁的后果不是"少释放一次"：确认卡还挂着就放锁 ⇒ 用户点「确认」时活动锁是空的、
   * 又能起一个回合（并发两回合 / 双倍扣费）；检查点暂停被当结束 ⇒「继续任务」点不动。
   * 所以这两条必须**留着锁**，而真正结束的结局必须放锁。
   */
  it('★★ confirm / 检查点暂停都留着活动锁，真正结束才放锁', async () => {
    let api: ReturnType<typeof useAgentQueueController> | null = null
    const finishQueuedTurn = vi.fn(async () => session)
    const props = input({
      controller: {
        finishQueuedTurn,
      } as unknown as AgentController,
    })

    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }

    renderToStaticMarkup(createElement(Probe))
    expect(
      claimSessionActivity(session.id, 'turn-1', 'turn-1'),
    ).toBe(true)

    // ① 等用户确认：锁留着，队列项也不许销
    await api!.settleSessionOutcome(
      session.id,
      {
        kind: 'confirm',
        request: { callId: 'call-1', name: 'runNode', args: {} },
        messages: [],
      },
      { queueTurnId: 'turn-1', turnId: 'turn-1' },
    )
    expect(isSessionActivityActive(session.id)).toBe(true)
    expect(finishQueuedTurn).not.toHaveBeenCalled()

    // ② 检查点暂停（可以「继续」）：锁同样留着
    await api!.settleSessionOutcome(
      session.id,
      {
        kind: 'stopped',
        reason: '达到步数上限',
        messages: [],
        checkpoint: {
          kind: 'max_steps',
          maxSteps: 3,
          completedSteps: 3,
        },
      },
      { queueTurnId: 'turn-1', turnId: 'turn-1' },
    )
    expect(isSessionActivityActive(session.id)).toBe(true)
    expect(finishQueuedTurn).not.toHaveBeenCalled()

    // ③ 对照：真正出错结束 ⇒ 必须放锁（否则队列永久判 busy）
    await api!.settleSessionOutcome(
      session.id,
      { kind: 'error' },
      { queueTurnId: 'turn-1', turnId: 'turn-1' },
    )
    expect(isSessionActivityActive(session.id)).toBe(false)
  })

  it('queueText 的全段读写进 lifecycle，关闭后拒绝新入队', async () => {
    let releaseRead!: () => void
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const lifecycle = createTaskLifecycle()
    const sessionsGet = vi.fn(async () => {
      await readGate
      return session
    })
    const enqueueTurn = vi.fn(async () => {
      await writeGate
      return { ok: true as const, session }
    })
    const props = input({
      sessions: {
        get: sessionsGet,
      } as unknown as AgentQueueControllerInput['sessions'],
      controller: {
        enqueueTurn,
      } as unknown as AgentController,
      trackRun: (work) => lifecycle.track(work),
    })
    let api: ReturnType<typeof useAgentQueueController> | null = null
    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))

    const queued = api!.queueText('延迟写入')
    lifecycle.beginClose()
    await expect(
      lifecycle.waitForIdle(5),
    ).rejects.toBeInstanceOf(TaskLifecycleTimeoutError)
    await expect(
      api!.queueText('关闭后'),
    ).rejects.toBeInstanceOf(TaskLifecycleClosedError)
    expect(enqueueTurn).not.toHaveBeenCalled()

    releaseRead()
    releaseWrite()
    await queued
    await lifecycle.waitForIdle(100)
    expect(enqueueTurn).toHaveBeenCalledOnce()
  })

  it('关闭后 queue pump 不领取新队首', async () => {
    const lifecycle = createTaskLifecycle()
    const claimNextQueuedTurn = vi.fn(async () => null)
    /** 被生命周期追踪的每一次投递：拿它当同步点，不用 `setTimeout` 猜时机。 */
    const tracked: Promise<unknown>[] = []
    const props = input({
      controller: {
        claimNextQueuedTurn,
      } as unknown as AgentController,
      trackRun: (work) => {
        const task = lifecycle.track(work)
        tracked.push(task)
        return task
      },
    })
    function Probe() {
      useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))

    claimSessionActivity(session.id, 'turn-active', 'turn-active')
    /**
     * 必须有自动续排标记，`queuePumpRef` 才会真的把泵叫起来。
     * 少了这一行，本用例就是空转：泵根本没被调用，`claimNextQueuedTurn` 当然没被调。
     */
    requestQueueDrain(session.id)
    lifecycle.beginClose()
    props.queuePumpRef.current(session.id)

    // 泵确实投进了生命周期、并被「已关闭」挡回 —— 这才是这条用例要证明的事
    expect(tracked).toHaveLength(1)
    await expect(tracked[0]).rejects.toBeInstanceOf(
      TaskLifecycleClosedError,
    )
    expect(claimNextQueuedTurn).not.toHaveBeenCalled()
  })

  /**
   * #904 审计的落点：pump 里「领取 → 发送」之间所有失败点都必须有明确归宿。
   * 这一条钉住最危险的那个：**发送失败时消息不许从队列消失**，且要有错误态。
   */
  it('★ 排队消息发送失败：消息留在队列（completed=false）、转错误态、只尝试一次', async () => {
    const lifecycle = createTaskLifecycle()
    const queued = {
      id: 'turn-1',
      text: '再生成一张',
      createdAt: 1,
      channelId: 'channel-1',
      model: 'GPT-6 Astra',
    }
    const claimed = {
      ...session,
      queuedTurns: [queued],
      activeTurnId: queued.id,
    }
    const finishQueuedTurn = vi.fn(async () => ({
      ...session,
      queuedTurns: [queued],
    }))
    const sendText = vi.fn(async () => {
      throw new Error('网络断了')
    })
    const props = input({
      controller: {
        claimNextQueuedTurn: vi.fn(async () => ({
          session: claimed,
          turn: queued,
        })),
        finishQueuedTurn,
      } as unknown as AgentController,
      sendText,
      trackRun: (work) => lifecycle.track(work),
    })
    let api: ReturnType<typeof useAgentQueueController> | null = null
    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))

    await api!.resumeQueue()
    await lifecycle.waitForIdle(100)

    expect(sendText).toHaveBeenCalledTimes(1)
    // 失败不销队：completed=false ⇒ 消息仍在 queuedTurns 里可重试
    expect(finishQueuedTurn).toHaveBeenCalledWith(session.id, queued.id, false)
    // 有明确错误态，不是静默吞掉
    expect(props.setStatusFor).toHaveBeenCalledWith(session.id, {
      kind: 'error',
      // #912 起在原始错误后面补一句可操作的指路文案
      message: expect.stringContaining('网络断了'),
    })
    // 活动锁必须释放，否则这条会话的队列会被永久卡死
    expect(isSessionActivityActive(session.id)).toBe(false)
  })

  it('★ 队首领取不到时不发送，并清掉自动续排标记', async () => {
    const lifecycle = createTaskLifecycle()
    const sendText = vi.fn(async () => undefined)
    const props = input({
      controller: {
        claimNextQueuedTurn: vi.fn(async () => null),
        finishQueuedTurn: vi.fn(async () => session),
      } as unknown as AgentController,
      sendText,
      trackRun: (work) => lifecycle.track(work),
    })
    let api: ReturnType<typeof useAgentQueueController> | null = null
    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))

    await api!.resumeQueue()

    expect(sendText).not.toHaveBeenCalled()
    expect(isSessionActivityActive(session.id)).toBe(false)
    // 空队列不保留自动续排标记，避免空闲时反复空转
    expect(shouldDrainQueue(session.id)).toBe(false)
  })

  /**
   * #912：结算失败会让 `activeTurnId` 残留 ⇒ 该会话的队首永远领不到。
   * 这两条钉住「先重试一次、再 releaseActiveTurn 兜底、最后队列还能被领到」。
   */
  const queuedTurn = {
    id: 'turn-1',
    text: '再生成一张',
    createdAt: 1,
    channelId: 'channel-1',
    model: 'GPT-6 Astra',
  }

  it('★ 结算首次抛错、重试成功：队列项保留、错误态一次、活动锁释放', async () => {
    const lifecycle = createTaskLifecycle()
    const queuedSession = {
      ...session,
      queuedTurns: [queuedTurn],
      activeTurnId: queuedTurn.id,
    }
    const finishQueuedTurn = vi
      .fn()
      .mockRejectedValueOnce(new Error('finish failed'))
      .mockResolvedValueOnce({ ...session, queuedTurns: [queuedTurn] })
    const releaseActiveTurn = vi.fn(async () => session)
    const sendText = vi.fn(async () => {
      throw new Error('send failed')
    })
    const props = input({
      controller: {
        claimNextQueuedTurn: vi.fn(async () => ({
          session: queuedSession,
          turn: queuedTurn,
        })),
        finishQueuedTurn,
      } as unknown as AgentController,
      sessions: {
        get: vi.fn(async () => session),
        releaseActiveTurn,
      } as unknown as AgentQueueControllerInput['sessions'],
      sendText,
      trackRun: (work) => lifecycle.track(work),
    })
    let api: ReturnType<typeof useAgentQueueController> | null = null
    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))

    await api!.resumeQueue()
    await lifecycle.waitForIdle(100)

    // 第二次结算成功 ⇒ 不该走 releaseActiveTurn 兜底
    expect(finishQueuedTurn).toHaveBeenCalledTimes(2)
    expect(releaseActiveTurn).not.toHaveBeenCalled()
    // 队列项仍在（返回的会话里还带着这条 turn）
    expect(props.applySessionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ queuedTurns: [queuedTurn] }),
    )
    expect(props.setStatusFor).toHaveBeenCalledTimes(1)
    expect(props.setStatusFor).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('恢复队列'),
      }),
    )
    expect(isSessionActivityActive(session.id)).toBe(false)
  })

  it('★★ 结算一直失败：走 releaseActiveTurn 兜底，随后仍能重新领到这条 turn', async () => {
    const lifecycle = createTaskLifecycle()
    /** 带状态的最小 store：`activeTurnId` 残留时 claim 必须返回 null。 */
    const store = {
      activeTurnId: undefined as string | undefined,
      queuedTurns: [queuedTurn],
    }
    const snapshot = () => ({
      ...session,
      queuedTurns: store.queuedTurns,
      ...(store.activeTurnId ? { activeTurnId: store.activeTurnId } : {}),
    })
    const claimNextQueuedTurn = vi.fn(async () => {
      if (store.activeTurnId) return null
      store.activeTurnId = queuedTurn.id
      return { session: snapshot(), turn: queuedTurn }
    })
    const finishQueuedTurn = vi.fn(async () => {
      throw new Error('finish failed')
    })
    const releaseActiveTurn = vi.fn(async () => {
      store.activeTurnId = undefined
      return snapshot()
    })
    const sendText = vi.fn(async () => {
      throw new Error('send failed')
    })
    const props = input({
      controller: {
        claimNextQueuedTurn,
        finishQueuedTurn,
      } as unknown as AgentController,
      sessions: {
        get: vi.fn(async () => snapshot()),
        releaseActiveTurn,
      } as unknown as AgentQueueControllerInput['sessions'],
      sendText,
      trackRun: (work) => lifecycle.track(work),
    })
    let api: ReturnType<typeof useAgentQueueController> | null = null
    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))

    await api!.resumeQueue()
    await lifecycle.waitForIdle(100)

    // 重试一次后仍失败 ⇒ releaseActiveTurn 兜底，且活动锁与自动续排都清掉
    expect(finishQueuedTurn).toHaveBeenCalledTimes(2)
    expect(releaseActiveTurn).toHaveBeenCalledTimes(1)
    expect(isSessionActivityActive(session.id)).toBe(false)
    expect(shouldDrainQueue(session.id)).toBe(false)
    expect(props.setStatusFor).toHaveBeenCalledWith(
      session.id,
      expect.objectContaining({
        kind: 'error',
        message: expect.stringContaining('队列结算失败'),
      }),
    )

    // 命门：兜底之后这条 turn 必须还能被重新领到（不是"函数被调用过"）
    await api!.resumeQueue()
    await lifecycle.waitForIdle(100)
    expect(claimNextQueuedTurn).toHaveBeenCalledTimes(2)
    expect(sendText).toHaveBeenCalledTimes(2)
    expect(sendText).toHaveBeenLastCalledWith(
      queuedTurn.text,
      expect.anything(),
      expect.objectContaining({ queueTurnId: queuedTurn.id }),
    )
  })

  /**
   * #915：#912 只兜住了「pump 自己抛错导致结算失败」那条路。还有一条更早的入口——
   * 会话行上的 `activeTurnId` 在**进入 pump 之前**就已经残留（例如上一次结算在别处失败）。
   * 这时 `claimNextQueuedTurn` 直接返回 null，pump 只会清掉自动续排标记 ⇒
   * 队列永久停摆、没有任何提示、「恢复队列」也救不回来。
   *
   * 判据不是「releaseActiveTurn 被调用过」，而是：清完之后**真的又领到了队首并只发一次**。
   */
  it('★★ 进 pump 前已有残留 activeTurnId：自愈一次并重新领到队首（只发一次）', async () => {
    const lifecycle = createTaskLifecycle()
    const store = {
      activeTurnId: queuedTurn.id as string | undefined,
      queuedTurns: [queuedTurn],
    }
    const snapshot = () => ({
      ...session,
      queuedTurns: store.queuedTurns,
      ...(store.activeTurnId ? { activeTurnId: store.activeTurnId } : {}),
    })
    const claimNextQueuedTurn = vi.fn(async () => {
      if (store.activeTurnId) return null
      store.activeTurnId = queuedTurn.id
      return { session: snapshot(), turn: queuedTurn }
    })
    const releaseActiveTurn = vi.fn(async () => {
      store.activeTurnId = undefined
      return snapshot()
    })
    const sendText = vi.fn(async () => undefined)
    const props = input({
      controller: {
        claimNextQueuedTurn,
        finishQueuedTurn: vi.fn(async () => snapshot()),
      } as unknown as AgentController,
      sessions: {
        get: vi.fn(async () => snapshot()),
        releaseActiveTurn,
      } as unknown as AgentQueueControllerInput['sessions'],
      sendText,
      trackRun: (work) => lifecycle.track(work),
    })
    let api: ReturnType<typeof useAgentQueueController> | null = null
    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))

    await api!.resumeQueue()
    await lifecycle.waitForIdle(100)

    // 先失败一次 → 清残留 → 再领到同一条
    expect(claimNextQueuedTurn).toHaveBeenCalledTimes(2)
    expect(releaseActiveTurn).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith(
      queuedTurn.text,
      expect.anything(),
      expect.objectContaining({ queueTurnId: queuedTurn.id }),
    )

    // 真正的回合还在跑（内存活动锁未释放）⇒ 再点「恢复队列」不得重复发送
    await api!.resumeQueue()
    await lifecycle.waitForIdle(100)
    expect(releaseActiveTurn).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
  })
})

/**
 * #932：把「写错会让用户感觉到」的分支补上。
 *
 * 只挑这几类：**双倍领取 / 消息静默丢失 / 草稿串台 / 队列停摆 / 卡死无提示 / 冻结字段错**。
 * getter、纯展示分支不补。
 */
describe('useAgentQueueController · 高危分支', () => {
  function mountHook(props: AgentQueueControllerInput) {
    let api: ReturnType<typeof useAgentQueueController> | null = null
    function Probe() {
      api = useAgentQueueController(props)
      return createElement('span', null, 'ok')
    }
    renderToStaticMarkup(createElement(Probe))
    return () => api!
  }

  afterEach(() => {
    releaseSessionActivity(session.id)
    clearQueueDrain(session.id)
  })

  it('★★ 同一会话同时两次泵：只领一次、只发一次（活动锁兜底，双泵 = 双倍扣费）', async () => {
    const gate = new Promise<null>(() => {})
    const claimNextQueuedTurn = vi.fn(() => gate)
    const sendText = vi.fn(async () => undefined)
    const props = input({
      controller: {
        claimNextQueuedTurn,
        finishQueuedTurn: vi.fn(async () => session),
      } as unknown as AgentController,
      sendText,
    })
    mountHook(props)
    requestQueueDrain(session.id)

    /**
     * 两次「该泵了」撞在一起：第一次卡在领取上，第二次**不许再领一次**。
     *
     * 注：`queuePumpingRef.has` 只是快路径，真正挡住的第二道闸是 `claimSessionActivity`
     * —— 把活动锁那道判断删掉，这条会红（队列泵会二次领取同一条 turn ⇒ 双发/双扣费）。
     */
    props.queuePumpRef.current(session.id)
    props.queuePumpRef.current(session.id)
    await vi.waitFor(() =>
      expect(claimNextQueuedTurn).toHaveBeenCalledTimes(1),
    )
    await Promise.resolve()
    expect(claimNextQueuedTurn).toHaveBeenCalledTimes(1)
    expect(sendText).not.toHaveBeenCalled()
  })

  it('★ 队列已满：给一次明确提示，不落草稿、不覆盖快照', async () => {
    const notify = vi.fn()
    const setDraft = vi.fn()
    const enqueueTurn = vi.fn(async () => ({
      ok: false as const,
      reason: 'full' as const,
    }))
    const props = input({
      notify,
      setDraft,
      controller: { enqueueTurn } as unknown as AgentController,
    })
    const api = mountHook(props)

    await expect(api().queueText('第九条')).resolves.toBe(false)

    expect(enqueueTurn).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      '排队任务已达上限，请先处理或删除队列中的任务',
      'error',
    )
    expect(setDraft).not.toHaveBeenCalled()
    expect(props.applySessionSnapshot).not.toHaveBeenCalled()
  })

  it('★ 排队成功但会话已切走：入队照常，不动别人的草稿', async () => {
    const setDraft = vi.fn()
    const props = input({ setDraft })
    props.currentIdRef.current = 'session-2'
    const api = mountHook(props)

    await expect(api().queueText('稍后发')).resolves.toBe(true)

    expect(props.controller.enqueueTurn).toHaveBeenCalledTimes(1)
    expect(props.applySessionSnapshot).toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('★★ 回合正常结束且队列还有活：自动再泵一轮（否则队列停摆）', async () => {
    const claimNextQueuedTurn = vi.fn(async () => null)
    const props = input({
      controller: {
        claimNextQueuedTurn,
        finishQueuedTurn: vi.fn(async () => session),
      } as unknown as AgentController,
    })
    const api = mountHook(props)
    expect(claimSessionActivity(session.id, 'turn-1', 'turn-1')).toBe(true)
    requestQueueDrain(session.id)

    await api().settleSessionOutcome(
      session.id,
      { kind: 'message', text: '完成', messages: [] },
      { queueTurnId: 'turn-1', turnId: 'turn-1' },
    )

    await vi.waitFor(() =>
      expect(claimNextQueuedTurn).toHaveBeenCalledWith(session.id),
    )
    // 再泵一轮之后锁必须收干净（否则下一次「恢复队列」会判 busy）
    await vi.waitFor(() =>
      expect(isSessionActivityActive(session.id)).toBe(false),
    )
  })

  it('★★ 残留标记清不掉：给可指路的错误文案，而不是静默卡住', async () => {
    const setStatusFor = vi.fn()
    const props = input({
      setStatusFor,
      controller: {
        claimNextQueuedTurn: vi.fn(async () => null),
        finishQueuedTurn: vi.fn(async () => session),
      } as unknown as AgentController,
      sessions: {
        get: vi.fn(async () => ({ ...session, activeTurnId: 'turn-stale' })),
        releaseActiveTurn: vi.fn(async () => null),
      } as unknown as AgentQueueControllerInput['sessions'],
    })
    const api = mountHook(props)
    requestQueueDrain(session.id)

    await api().resumeQueue()

    expect(setStatusFor).toHaveBeenCalledWith(session.id, {
      kind: 'error',
      message: '队列被一条残留的进行中记录卡住，请重启应用',
    })
    expect(isSessionActivityActive(session.id)).toBe(false)
  })

  it('★ 冻结视频模型 / 技能 / 自动执行（漏一个就是发错模型或丢技能）', async () => {
    const frozen = {
      ...session,
      videoModel: 'video-1',
      skillId: 'skill-1',
      autoRun: true,
    }
    const props = input({
      current: frozen,
      sessions: {
        get: vi.fn(async () => frozen),
      } as unknown as AgentQueueControllerInput['sessions'],
    })
    const api = mountHook(props)

    await expect(api().queueText('按这个来')).resolves.toBe(true)

    expect(props.controller.enqueueTurn).toHaveBeenCalledWith(
      frozen.id,
      expect.objectContaining({
        videoModel: 'video-1',
        skillId: 'skill-1',
        autoRun: true,
      }),
    )
  })

  it('★ 空白文本 / 没有会话：都不入队（空回合会白扣一次）', async () => {
    const props = input()
    const api = mountHook(props)

    await expect(api().queueText('   ')).resolves.toBe(false)
    expect(props.controller.enqueueTurn).not.toHaveBeenCalled()
    // 正向对照：同一实例换成有效文本必须真的入队
    await expect(api().queueText('有内容')).resolves.toBe(true)
    expect(props.controller.enqueueTurn).toHaveBeenCalledTimes(1)

    const empty = input({ current: null })
    const emptyApi = mountHook(empty)
    await expect(emptyApi().queueText('没有会话')).resolves.toBe(false)
    expect(empty.controller.enqueueTurn).not.toHaveBeenCalled()
  })
})

/**
 * #934-A：队列删改三件套（删一项 / 进编辑 / 提交编辑）。
 *
 * 这三条写错的后果都能被用户看见：删了还在、菜单不关、改完不生效或把空文案写进队列。
 * 编辑态走 React state，所以这里用会重渲染的 TestRenderer，不用 `renderToStaticMarkup`。
 */
describe('useAgentQueueController · 队列删改三件套', () => {
  const turn1 = {
    id: 'turn-1',
    text: '第一条',
    createdAt: 1,
    channelId: 'channel-1',
    model: 'GPT-6 Astra',
  }
  const turn2 = { ...turn1, id: 'turn-2', text: '第二条', createdAt: 2 }

  function mountLive(props: AgentQueueControllerInput) {
    const ref: { current: ReturnType<typeof useAgentQueueController> | null } =
      { current: null }
    function Probe() {
      ref.current = useAgentQueueController(props)
      return null
    }
    let renderer!: TestRenderer.ReactTestRenderer
    act(() => {
      renderer = TestRenderer.create(createElement(Probe))
    })
    return {
      get: () => ref.current!,
      update: (next: AgentQueueControllerInput) => {
        act(() => renderer.update(createElement(Probe, next)))
      },
      unmount: () => act(() => renderer.unmount()),
    }
  }

  afterEach(() => {
    releaseSessionActivity(session.id)
    clearQueueDrain(session.id)
  })

  it('★ 删一项：用返回的会话刷新，并把该项菜单关掉（其它项菜单保持）', async () => {
    const remaining = { ...session, queuedTurns: [turn2] }
    const removeQueuedTurn = vi.fn(async () => remaining)
    const applySessionSnapshot = vi.fn()
    const setQueueMenuId = vi.fn()
    const h = mountLive(
      input({
        current: { ...session, queuedTurns: [turn1, turn2] },
        controller: { removeQueuedTurn } as unknown as AgentController,
        applySessionSnapshot,
        setQueueMenuId,
      }),
    )

    await act(async () => {
      await h.get().removeQueued('turn-1')
    })

    expect(removeQueuedTurn).toHaveBeenCalledWith(session.id, 'turn-1')
    expect(applySessionSnapshot).toHaveBeenCalledWith(remaining)
    const settleMenu = setQueueMenuId.mock.calls[0]![0] as (
      id: string | null,
    ) => string | null
    expect(settleMenu('turn-1')).toBeNull()
    expect(settleMenu('turn-2')).toBe('turn-2')
  })

  it('★ 删一项返回 null（已被别处删掉）：不刷新快照，但菜单照关', async () => {
    const applySessionSnapshot = vi.fn()
    const setQueueMenuId = vi.fn()
    const h = mountLive(
      input({
        controller: {
          removeQueuedTurn: vi.fn(async () => null),
        } as unknown as AgentController,
        applySessionSnapshot,
        setQueueMenuId,
      }),
    )

    await act(async () => {
      await h.get().removeQueued('turn-1')
    })

    expect(applySessionSnapshot).not.toHaveBeenCalled()
    expect(setQueueMenuId).toHaveBeenCalled()

    // 没有当前会话时整段 no-op（别把别的会话的队列删了）
    const none = input({ current: null })
    const noneHook = mountLive(none)
    await act(async () => {
      await noneHook.get().removeQueued('turn-1')
    })
    expect(none.controller.removeQueuedTurn).not.toHaveBeenCalled()
  })

  it('★★ 进编辑 → 改文案 → 提交：新文案交给 controller，编辑态清空', async () => {
    const editQueuedTurn = vi.fn(async () => session)
    const applySessionSnapshot = vi.fn()
    const setQueueMenuId = vi.fn()
    const h = mountLive(
      input({
        controller: { editQueuedTurn } as unknown as AgentController,
        applySessionSnapshot,
        setQueueMenuId,
      }),
    )

    act(() => {
      h.get().beginQueueEdit(turn2)
    })
    // 进编辑会先关菜单，并把原文填进输入
    expect(setQueueMenuId).toHaveBeenCalledWith(null)
    expect(h.get().editingQueueId).toBe('turn-2')
    expect(h.get().editingQueueText).toBe('第二条')

    act(() => {
      h.get().setEditingQueueText('  新文案  ')
    })
    expect(h.get().editingQueueText).toBe('  新文案  ')

    await act(async () => {
      await h.get().commitQueueEdit()
    })

    expect(editQueuedTurn).toHaveBeenCalledWith(
      session.id,
      'turn-2',
      '新文案',
    )
    expect(applySessionSnapshot).toHaveBeenCalledWith(session)
    expect(h.get().editingQueueId).toBeNull()
    expect(h.get().editingQueueText).toBe('')
  })

  it('★★ 空文案提交：提示一次，且绝不把空串写进队列（编辑态保留）', async () => {
    const editQueuedTurn = vi.fn(async () => session)
    const notify = vi.fn()
    const h = mountLive(
      input({
        controller: { editQueuedTurn } as unknown as AgentController,
        notify,
      }),
    )

    act(() => {
      h.get().beginQueueEdit(turn2)
    })
    act(() => {
      h.get().setEditingQueueText('   ')
    })
    await act(async () => {
      await h.get().commitQueueEdit()
    })

    expect(notify).toHaveBeenCalledWith('消息不能为空', 'error')
    expect(editQueuedTurn).not.toHaveBeenCalled()
    // 正向证据：确实进了"空文案"这条分支 —— 编辑态没被清掉，用户还能继续改
    expect(h.get().editingQueueId).toBe('turn-2')

    // 没进编辑态就提交：整段 no-op
    const idle = mountLive(input())
    await act(async () => {
      await idle.get().commitQueueEdit()
    })
    expect(idle.get().editingQueueId).toBeNull()
  })
})
