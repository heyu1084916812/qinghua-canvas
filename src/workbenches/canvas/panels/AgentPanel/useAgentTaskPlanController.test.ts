import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceAgentTaskPlanAfterReview,
  type AgentTaskPlan,
} from '../../../../domain/agent/taskPlan'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  IDLE_STATUS,
  type AgentPanelStatus,
} from './AgentActivityViews'
import {
  useAgentTaskPlanController,
  type AgentTaskPlanControllerInput,
} from './useAgentTaskPlanController'

type Hook = ReturnType<typeof useAgentTaskPlanController>

function plan(): AgentTaskPlan {
  return {
    id: 'plan-1',
    title: '发布准备',
    currentStepId: 'step-1',
    createdAt: 1,
    updatedAt: 1,
    steps: [
      {
        id: 'step-1',
        title: '完成设计',
        status: 'in_progress',
        resultsReadyAt: 2,
      },
      {
        id: 'step-2',
        title: '整理输出',
        status: 'pending',
      },
    ],
  }
}

function session(id: string, taskPlan = plan()): AgentSession {
  return {
    id,
    projectId: 'p1',
    title: `会话 ${id}`,
    channelId: '',
    model: 'GPT-6 Astra',
    taskPlan,
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function advancedSession(target: AgentSession): AgentSession {
  const advanced = advanceAgentTaskPlanAfterReview(
    target.taskPlan!,
    target.taskPlan?.currentStepId,
    10,
  )
  if (!advanced.ok) throw new Error(advanced.problems.join('；'))
  return {
    ...target,
    taskPlan: advanced.plan,
    pendingConfirmation: undefined,
    continuation: undefined,
    allowedToolNames: undefined,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function input(
  patch: Partial<AgentTaskPlanControllerInput> = {},
): AgentTaskPlanControllerInput {
  return {
    statusFor: vi.fn(() => IDLE_STATUS),
    trackRun: <T,>(work: () => Promise<T>) => work(),
    abortSession: vi.fn(),
    isActivityActive: vi.fn(() => false),
    clearRunPresentationFor: vi.fn(),
    setStatusFor: vi.fn(),
    updateSessionFields: vi.fn(async (sessionId, values) => ({
      ...session(sessionId),
      ...values,
    })),
    applySessionSnapshot: vi.fn(),
    settleInterruptedSession: vi.fn(async () => ({})),
    sendText: vi.fn(async () => undefined),
    notify: vi.fn(),
    /** 默认口径：目标就是当前会话（不传也一样，这里写出来是为了让「切走」的用例有对照） */
    isCurrentSession: () => true,
    ...patch,
  }
}

function render(props: AgentTaskPlanControllerInput): {
  viewRef: { current: Hook | null }
  renderer: TestRenderer.ReactTestRenderer
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe(next: AgentTaskPlanControllerInput) {
    viewRef.current = useAgentTaskPlanController(next)
    return null
  }
  let renderer!: TestRenderer.ReactTestRenderer
  act(() => {
    renderer = TestRenderer.create(createElement(Probe, props))
  })
  return { viewRef, renderer }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useAgentTaskPlanController', () => {
  it('同 session 并发调用复用同一 Promise，只更新和发送一次', async () => {
    const target = session('s1')
    const update = deferred<AgentSession | null>()
    const updateSessionFields = vi.fn(() => update.promise)
    const sendText = vi.fn(async () => undefined)
    const props = input({ updateSessionFields, sendText })
    const { viewRef } = render(props)

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = viewRef.current!.advanceTaskPlan(target)
      second = viewRef.current!.advanceTaskPlan(target)
    })
    expect(first).toBe(second)
    expect(viewRef.current!.isAdvancingTaskPlan('s1')).toBe(true)

    const updated = advancedSession(target)
    await act(async () => {
      update.resolve(updated)
      await expect(first).resolves.toBe(true)
    })
    expect(updateSessionFields).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith(
      expect.stringContaining('现在开始执行计划步骤「整理输出」'),
      updated,
      { internalControl: true },
    )
    expect(viewRef.current!.isAdvancingTaskPlan('s1')).toBe(false)
  })

  it('trackRun 同步抛错时返回 rejected Promise 并清理状态', async () => {
    const target = session('s1')
    const error = new Error('track closed')
    const trackRun = vi
      .fn()
      .mockImplementationOnce(() => {
        throw error
      })
      .mockImplementation(<T,>(work: () => Promise<T>) => work())
    const updateSessionFields = vi.fn(async () => advancedSession(target))
    const sendText = vi.fn(async () => undefined)
    const { viewRef } = render(
      input({ trackRun, updateSessionFields, sendText }),
    )

    let rejected!: Promise<boolean>
    await act(async () => {
      expect(() => {
        rejected = viewRef.current!.advanceTaskPlan(target)
      }).not.toThrow()
      await expect(rejected).rejects.toBe(error)
    })
    expect(viewRef.current!.isAdvancingTaskPlan('s1')).toBe(false)

    await act(async () => {
      await expect(
        viewRef.current!.advanceTaskPlan(target),
      ).resolves.toBe(true)
    })
    expect(updateSessionFields).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(viewRef.current!.isAdvancingTaskPlan('s1')).toBe(false)
  })

  it('A/B advancing 状态按 session 隔离', async () => {
    const firstTarget = session('a')
    const secondTarget = session('b')
    const firstUpdate = deferred<AgentSession | null>()
    const secondUpdate = deferred<AgentSession | null>()
    const updateSessionFields = vi.fn(
      (sessionId: string) =>
        sessionId === 'a' ? firstUpdate.promise : secondUpdate.promise,
    )
    const { viewRef } = render(input({ updateSessionFields }))

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = viewRef.current!.advanceTaskPlan(firstTarget)
    })
    expect(viewRef.current!.isAdvancingTaskPlan('a')).toBe(true)
    expect(viewRef.current!.isAdvancingTaskPlan('b')).toBe(false)

    act(() => {
      second = viewRef.current!.advanceTaskPlan(secondTarget)
    })
    expect(viewRef.current!.isAdvancingTaskPlan('b')).toBe(true)

    await act(async () => {
      firstUpdate.resolve(advancedSession(firstTarget))
      await first
    })
    expect(viewRef.current!.isAdvancingTaskPlan('a')).toBe(false)
    expect(viewRef.current!.isAdvancingTaskPlan('b')).toBe(true)

    await act(async () => {
      secondUpdate.resolve(advancedSession(secondTarget))
      await second
    })
    expect(viewRef.current!.isAdvancingTaskPlan('b')).toBe(false)
  })

  /**
   * #913：**推进途中切会话**。
   *
   * 用户点了「跳过这一步的验收」，然后在「取消旧确认 → 等旧回合收尾」这几段 await
   * 期间切到会话 B。切走之后必须整单退出：
   * - 不落计划（A 的 taskPlan 不许被这次点击悄悄改掉）；
   * - **不发那条隐藏控制消息** —— 它等于替用户开一次没人看着的付费回合；
   * - 不写 B 的任何东西（B 根本没参与这次点击）；
   * - advancing 只在 A 上清掉（`finally`），B 从头到尾不许被标过。
   */
  it('审批结算途中切到会话 B：不落库、不发隐藏控制消息、advancing 只在 A 上清', async () => {
    const target = session('s1')
    const settle = deferred<{ cleanupError?: unknown }>()
    const statusFor = vi.fn(
      (sessionId: string): AgentPanelStatus =>
        sessionId === 's1'
          ? {
              kind: 'awaitingConfirm',
              request: {
                callId: 'call-1',
                name: 'requestTaskConfirmation',
                args: { stepId: 'step-1' },
              },
            }
          : IDLE_STATUS,
    )
    const settleInterruptedSession = vi.fn(() => settle.promise)
    const updateSessionFields = vi.fn(async () => advancedSession(target))
    const sendText = vi.fn(async () => undefined)
    const applySessionSnapshot = vi.fn()
    const clearRunPresentationFor = vi.fn()
    const setStatusFor = vi.fn()
    const notify = vi.fn()
    let currentId = 's1'
    const { viewRef } = render(
      input({
        statusFor,
        settleInterruptedSession,
        updateSessionFields,
        sendText,
        applySessionSnapshot,
        clearRunPresentationFor,
        setStatusFor,
        notify,
        isCurrentSession: (sessionId) => sessionId === currentId,
      }),
    )

    let advancing!: Promise<boolean>
    act(() => {
      advancing = viewRef.current!.advanceTaskPlan(target)
    })
    await vi.waitFor(() => {
      expect(settleInterruptedSession).toHaveBeenCalledTimes(1)
    })
    // 结算还没回来：A 正在推进
    expect(viewRef.current!.isAdvancingTaskPlan('s1')).toBe(true)

    // 用户切到 B，随后结算返回
    currentId = 's2'
    await act(async () => {
      settle.resolve({})
      await expect(advancing).resolves.toBe(false)
    })

    // ① 不发隐藏控制消息
    expect(sendText).not.toHaveBeenCalled()
    // ② 不落 A 的计划；所有按会话的写都不该发生（B 更是完全没被碰到）
    expect(updateSessionFields).not.toHaveBeenCalled()
    expect(applySessionSnapshot).not.toHaveBeenCalled()
    expect(clearRunPresentationFor).not.toHaveBeenCalled()
    expect(setStatusFor).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    // ③ advancing 只在 A 上清掉，B 从未被标记
    expect(viewRef.current!.isAdvancingTaskPlan('s1')).toBe(false)
    expect(viewRef.current!.isAdvancingTaskPlan('s2')).toBe(false)
  })

  /**
   * 反例：目标仍是当前会话时**必须照常推进并发出控制消息**。
   * 没有这一条，上面那条可以靠「干脆什么都不做」通过 —— 功能被悄悄关死也测不出来。
   */
  it('目标仍是当前会话时照常推进并发隐藏控制消息（反例）', async () => {
    const target = session('s1')
    const updateSessionFields = vi.fn(async () =>
      advancedSession(target),
    )
    const sendText = vi.fn(async () => undefined)
    const { viewRef } = render(
      input({
        updateSessionFields,
        sendText,
        isCurrentSession: (sessionId) => sessionId === 's1',
      }),
    )

    await act(async () => {
      await expect(
        viewRef.current!.advanceTaskPlan(target),
      ).resolves.toBe(true)
    })
    expect(updateSessionFields).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(viewRef.current!.isAdvancingTaskPlan('s1')).toBe(false)
  })

  it('pendingConfirmation 和 status 都按目标 session 读取', async () => {
    const target = session('s2')
    const settle = deferred<{ cleanupError?: unknown }>()
    const statusFor = vi.fn((sessionId: string): AgentPanelStatus =>
      sessionId === 's2'
        ? {
            kind: 'awaitingConfirm',
            request: {
              callId: 'call-2',
              name: 'requestTaskConfirmation',
              args: { stepId: 'step-1' },
            },
          }
        : IDLE_STATUS,
    )
    const settleInterruptedSession = vi.fn(() => settle.promise)
    const updateSessionFields = vi.fn(async () =>
      advancedSession(target),
    )
    const { viewRef } = render(
      input({ statusFor, settleInterruptedSession, updateSessionFields }),
    )

    let advancing!: Promise<boolean>
    act(() => {
      advancing = viewRef.current!.advanceTaskPlan(target)
    })
    await vi.waitFor(() => {
      expect(settleInterruptedSession).toHaveBeenCalledWith(
        target,
        expect.objectContaining({ callId: 'call-2' }),
        'canceled',
      )
    })
    await act(async () => {
      settle.resolve({})
      await expect(advancing).resolves.toBe(true)
    })
    expect(statusFor).toHaveBeenCalledWith('s2')
    expect(updateSessionFields).toHaveBeenCalledTimes(1)
  })

  it('settle cleanupError 时停止，不落计划、不发消息、不双提示', async () => {
    const target = session('s1')
    const statusFor = vi.fn((): AgentPanelStatus => ({
      kind: 'awaitingConfirm',
      request: {
        callId: 'call-1',
        name: 'requestTaskConfirmation',
        args: { stepId: 'step-1' },
      },
    }))
    const updateSessionFields = vi.fn()
    const sendText = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        statusFor,
        settleInterruptedSession: vi.fn(async () => ({
          cleanupError: new Error('cleanup failed'),
        })),
        updateSessionFields,
        sendText,
        notify,
      }),
    )

    await act(async () => {
      await expect(
        viewRef.current!.advanceTaskPlan(target),
      ).resolves.toBe(false)
    })
    expect(statusFor).toHaveBeenCalledWith('s1')
    expect(updateSessionFields).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('活动锁等待 60 次后超时，不落计划也不发消息', async () => {
    vi.useFakeTimers()
    const updateSessionFields = vi.fn()
    const sendText = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        isActivityActive: () => true,
        updateSessionFields,
        sendText,
        notify,
      }),
    )

    let advancing!: Promise<boolean>
    act(() => {
      advancing = viewRef.current!.advanceTaskPlan(session('s1'))
    })
    await act(async () => {
      await vi.runAllTimersAsync()
      await expect(advancing).resolves.toBe(false)
    })
    expect(updateSessionFields).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      '旧验收仍在收尾，请稍后再点一次',
      'error',
    )
  })

  it('活动锁中途释放后继续推进', async () => {
    vi.useFakeTimers()
    let activeChecks = 0
    const isActivityActive = vi.fn(() => {
      activeChecks += 1
      return activeChecks <= 2
    })
    const updateSessionFields = vi.fn(async (_sessionId, values) => ({
      ...session('s1'),
      ...values,
    }))
    const { viewRef } = render(
      input({ isActivityActive, updateSessionFields }),
    )

    let advancing!: Promise<boolean>
    act(() => {
      advancing = viewRef.current!.advanceTaskPlan(session('s1'))
    })
    await act(async () => {
      await vi.runAllTimersAsync()
      await expect(advancing).resolves.toBe(true)
    })
    expect(updateSessionFields).toHaveBeenCalledTimes(1)
  })

  it('updateFields 返回 null 时不 fallback、不装成功、不发控制消息', async () => {
    const clearRunPresentationFor = vi.fn()
    const applySessionSnapshot = vi.fn()
    const setStatusFor = vi.fn()
    const sendText = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        updateSessionFields: vi.fn(async () => null),
        clearRunPresentationFor,
        applySessionSnapshot,
        setStatusFor,
        sendText,
        notify,
      }),
    )

    await act(async () => {
      await expect(
        viewRef.current!.advanceTaskPlan(session('s1')),
      ).resolves.toBe(false)
    })
    expect(clearRunPresentationFor).not.toHaveBeenCalled()
    expect(applySessionSnapshot).not.toHaveBeenCalled()
    expect(setStatusFor).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('最后一步推进后提示计划结束，不再发送隐藏控制消息', async () => {
    const finalPlan = plan()
    finalPlan.steps = [
      {
        id: 'step-1',
        title: '完成设计',
        status: 'done',
        finishedAt: 2,
      },
      {
        id: 'step-2',
        title: '整理输出',
        status: 'in_progress',
        resultsReadyAt: 3,
      },
    ]
    finalPlan.currentStepId = 'step-2'
    const target = session('s1', finalPlan)
    const updateSessionFields = vi.fn(async (_sessionId, values) => ({
      ...target,
      ...values,
    }))
    const sendText = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({ updateSessionFields, sendText, notify }),
    )

    await act(async () => {
      await expect(
        viewRef.current!.advanceTaskPlan(target),
      ).resolves.toBe(true)
    })
    expect(notify).toHaveBeenCalledWith(
      '已完成「整理输出」，整个计划已结束',
      'info',
    )
    expect(sendText).not.toHaveBeenCalled()
  })

  it('unmount 后等待中的推进不会继续写运行态或发消息', async () => {
    const sleep = deferred<void>()
    const updateSessionFields = vi.fn()
    const clearRunPresentationFor = vi.fn()
    const setStatusFor = vi.fn()
    const sendText = vi.fn()
    const { viewRef, renderer } = render(
      input({
        isActivityActive: () => true,
        sleep: () => sleep.promise,
        updateSessionFields,
        clearRunPresentationFor,
        setStatusFor,
        sendText,
      }),
    )

    let advancing!: Promise<boolean>
    act(() => {
      advancing = viewRef.current!.advanceTaskPlan(session('s1'))
    })
    act(() => renderer.unmount())
    await act(async () => {
      sleep.resolve()
      await expect(advancing).resolves.toBe(false)
    })
    expect(updateSessionFields).not.toHaveBeenCalled()
    expect(clearRunPresentationFor).not.toHaveBeenCalled()
    expect(setStatusFor).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })
})
