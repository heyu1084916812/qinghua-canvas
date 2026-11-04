import { createElement } from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { QueuedAgentTurn } from '../../../../domain/agent/queuedTurn'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  IDLE_STATUS,
  type AgentPanelStatus,
} from './AgentActivityViews'
import {
  useAgentSteeringController,
  type AgentSteeringControllerInput,
} from './useAgentSteeringController'

type Hook = ReturnType<typeof useAgentSteeringController>

const STEERABLE: AgentPanelStatus = { kind: 'thinking' }

function session(id: string): AgentSession {
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

function turn(id = 'turn-1'): QueuedAgentTurn {
  return {
    id,
    text: '把颜色调暖一些',
    createdAt: 1,
    channelId: 'channel-frozen',
    model: 'Frozen Model',
    imageModel: 'Frozen Image',
    skillId: 'skill-frozen',
    autoRun: true,
  }
}

function confirmationStatus(): AgentPanelStatus {
  return {
    kind: 'awaitingConfirm',
    request: {
      callId: 'call-1',
      name: 'node.delete',
      args: {},
    },
  }
}

function input(
  patch: Partial<AgentSteeringControllerInput> = {},
): AgentSteeringControllerInput {
  return {
    current: session('s1'),
    statusFor: vi.fn(() => STEERABLE),
    isCurrentSession: vi.fn(() => true),
    trackRun: <T,>(work: () => Promise<T>) => work(),
    queueText: vi.fn(async () => true),
    sendText: vi.fn(async () => undefined),
    settleInterruptedSession: vi.fn(async () => ({})),
    removeQueuedTurn: vi.fn(async () => session('s1')),
    promoteQueuedTurnToSteer: vi.fn(async (sessionId) => ({
      ok: true as const,
      session: session(sessionId),
    })),
    enqueueSteer: vi.fn(async (sessionId) => ({
      ok: true as const,
      session: session(sessionId),
    })),
    getQueuedJob: vi.fn(async () => null),
    cancelQueuedJob: vi.fn(async () => undefined),
    applySessionSnapshot: vi.fn(),
    setDraft: vi.fn(),
    writeDraftForSession: vi.fn(),
    setQueueMenuId: vi.fn(),
    notify: vi.fn(),
    ...patch,
  }
}

function render(props: AgentSteeringControllerInput): {
  viewRef: { current: Hook | null }
  update: (next: AgentSteeringControllerInput) => void
} {
  const viewRef: { current: Hook | null } = { current: null }
  function Probe(next: AgentSteeringControllerInput) {
    viewRef.current = useAgentSteeringController(next)
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

/**
 * 取出 `setDraft` 收到的 updater 并执行它 —— 真实 React 会在下一次渲染时执行，
 * 这里手动跑一遍，才能断言「消息真的回到输入框，而且落到了该会话的草稿里」。
 */
function runDraftUpdater(
  setDraft: ReturnType<typeof vi.fn>,
  previous = '',
): string {
  const updater = setDraft.mock.calls[0]?.[0]
  if (typeof updater !== 'function') {
    throw new Error('setDraft 没有收到 updater，消息没有回到输入框')
  }
  return (updater as (value: string) => string)(previous)
}

describe('useAgentSteeringController / guideDraft', () => {
  it('无 current 返回 false；带附件改为 queueText 一次', async () => {
    const noQueue = vi.fn()
    const noEnqueue = vi.fn()
    const noCurrent = render(
      input({
        current: null,
        queueText: noQueue,
        enqueueSteer: noEnqueue,
      }),
    )
    await act(async () => {
      await expect(
        noCurrent.viewRef.current!.guideDraft('继续'),
      ).resolves.toBe(false)
    })
    expect(noQueue).not.toHaveBeenCalled()
    expect(noEnqueue).not.toHaveBeenCalled()

    const queueText = vi.fn(async () => true)
    const enqueueSteer = vi.fn()
    const target = { ...session('s1'), pendingAssetIds: ['img-1'] }
    const harness = render(
      input({ current: target, queueText, enqueueSteer }),
    )
    await act(async () => {
      await expect(
        harness.viewRef.current!.guideDraft('继续'),
      ).resolves.toBe(true)
    })
    expect(queueText).toHaveBeenCalledTimes(1)
    expect(enqueueSteer).not.toHaveBeenCalled()
  })

  it('正常 enqueueSteer 后 apply 并清当前草稿', async () => {
    const enqueueSteer = vi.fn(async (sessionId) => ({
      ok: true as const,
      session: session(sessionId),
    }))
    const applySessionSnapshot = vi.fn()
    const setDraft = vi.fn()
    const writeDraftForSession = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        enqueueSteer,
        applySessionSnapshot,
        setDraft,
        writeDraftForSession,
        notify,
      }),
    )

    await act(async () => {
      await expect(
        viewRef.current!.guideDraft('继续'),
      ).resolves.toBe(true)
    })
    expect(enqueueSteer).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ text: '继续' }),
    )
    expect(applySessionSnapshot).toHaveBeenCalledTimes(1)
    const updater = setDraft.mock.calls[0]![0] as (
      previous: string,
    ) => string
    expect(updater('继续')).toBe('')
    expect(updater('继续剩下的内容')).toBe('继续剩下的内容')
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', '')
    expect(writeDraftForSession).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      '已作为引导发送，将在 Agent 下一次动作前应用',
      'info',
    )
  })

  it('enqueueSteer 失败文案保持原文并返回 false', async () => {
    const cases = [
      ['full', '当前任务的引导已达上限'],
      ['missing', '引导发送失败，请稍后重试'],
    ] as const
    for (const [reason, message] of cases) {
      const notify = vi.fn()
      const harness = render(
        input({
          notify,
          enqueueSteer: vi.fn(async () => ({
            ok: false as const,
            reason,
          })),
        }),
      )
      await act(async () => {
        await expect(
          harness.viewRef.current!.guideDraft('继续'),
        ).resolves.toBe(false)
      })
      expect(notify).toHaveBeenCalledTimes(1)
      expect(notify).toHaveBeenCalledWith(message, 'error')
    }
  })

  it('确认卡路径 deferred settle 后才 send，只发送一次', async () => {
    const settle = deferred<{ cleanupError?: unknown }>()
    const sendText = vi.fn(async () => undefined)
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        settleInterruptedSession: vi.fn(() => settle.promise),
        sendText,
      }),
    )

    let guiding!: Promise<boolean>
    act(() => {
      guiding = viewRef.current!.guideDraft('继续')
    })
    expect(sendText).not.toHaveBeenCalled()
    await act(async () => {
      settle.resolve({})
      await expect(guiding).resolves.toBe(true)
    })
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('cleanupError 不 send', async () => {
    const sendText = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        settleInterruptedSession: vi.fn(async () => ({
          cleanupError: new Error('cleanup failed'),
        })),
        sendText,
      }),
    )
    await act(async () => {
      await expect(
        viewRef.current!.guideDraft('继续'),
      ).resolves.toBe(false)
    })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('确认路径 send reject 时只发送一次且不清草稿', async () => {
    const sendText = vi.fn(async () => {
      throw new Error('send failed')
    })
    const setDraft = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        sendText,
        setDraft,
      }),
    )
    await act(async () => {
      await expect(
        viewRef.current!.guideDraft('继续'),
      ).rejects.toThrow('send failed')
    })
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('目标切走后不清 B 草稿', async () => {
    const enqueue = deferred<{
      ok: true
      session: AgentSession
    }>()
    let currentId = 'a'
    const props = input({
      current: session('a'),
      isCurrentSession: (sessionId) => sessionId === currentId,
      enqueueSteer: vi.fn(() => enqueue.promise),
    })
    const { viewRef, update } = render(props)

    let guiding!: Promise<boolean>
    act(() => {
      guiding = viewRef.current!.guideDraft('A 的引导')
    })
    currentId = 'b'
    update({ ...props, current: session('b') })
    await act(async () => {
      enqueue.resolve({ ok: true, session: session('a') })
      await expect(guiding).resolves.toBe(true)
    })
    expect(props.setDraft).not.toHaveBeenCalled()
  })
})

describe('useAgentSteeringController / guideQueuedTurn', () => {
  it('非 steerable 和带附件 turn 都 no-op/不 remove', async () => {
    const removeQueuedTurn = vi.fn()
    const nonSteerable = render(
      input({
        statusFor: () => IDLE_STATUS,
        removeQueuedTurn,
      }),
    )
    await act(async () => {
      await nonSteerable.viewRef.current!.guideQueuedTurn(turn())
    })
    expect(removeQueuedTurn).not.toHaveBeenCalled()

    const notify = vi.fn()
    const withAssets = render(
      input({
        removeQueuedTurn,
        notify,
      }),
    )
    await act(async () => {
      await withAssets.viewRef.current!.guideQueuedTurn({
        ...turn(),
        pendingAssetIds: ['img-1'],
      })
    })
    expect(removeQueuedTurn).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(
      '带新素材的消息不能中途引导，请等它按队列发送',
      'error',
    )
  })

  it('确认卡路径按 remove → apply → cancel → settle → send 顺序', async () => {
    const events: string[] = []
    const settle = deferred<{ cleanupError?: unknown }>()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        getQueuedJob: vi.fn(async () => ({
          id: 'job-1',
          status: 'queued',
        })),
        removeQueuedTurn: vi.fn(async () => {
          events.push('remove')
          return session('s1')
        }),
        applySessionSnapshot: vi.fn(() => events.push('apply')),
        cancelQueuedJob: vi.fn(async () => {
          events.push('cancel')
        }),
        settleInterruptedSession: vi.fn(() => {
          events.push('settle')
          return settle.promise
        }),
        sendText: vi.fn(async (_text, target) => {
          events.push('send')
          expect(target).toMatchObject({
            model: 'Frozen Model',
            imageModel: 'Frozen Image',
            skillId: 'skill-frozen',
          })
        }),
      }),
    )

    let guiding!: Promise<void>
    act(() => {
      guiding = viewRef.current!.guideQueuedTurn(turn())
    })
    await vi.waitFor(() => {
      expect(events).toEqual(['remove', 'apply', 'cancel', 'settle'])
    })
    await act(async () => {
      settle.resolve({})
      await guiding
    })
    expect(events).toEqual([
      'remove',
      'apply',
      'cancel',
      'settle',
      'send',
    ])
  })

  it('确认卡 cleanupError 不 send，并把消息放回输入框', async () => {
    const sendText = vi.fn()
    const setDraft = vi.fn()
    const writeDraftForSession = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        settleInterruptedSession: vi.fn(async () => ({
          cleanupError: new Error('cleanup failed'),
        })),
        sendText,
        setDraft,
        writeDraftForSession,
        notify,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(sendText).not.toHaveBeenCalled()
    // 队列项已经摘掉：失败必须把消息还回去，不能静默丢
    const updater = setDraft.mock.calls[0]?.[0] as (prev: string) => string
    expect(updater('')).toBe('把颜色调暖一些')
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', '把颜色调暖一些')
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('已放回输入框'),
      'error',
    )
  })

  it('settle 抛错时把消息放回输入框，不向上抛', async () => {
    const sendText = vi.fn()
    const setDraft = vi.fn()
    const writeDraftForSession = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        settleInterruptedSession: vi.fn(async () => {
          throw new Error('settle failed')
        }),
        sendText,
        setDraft,
        writeDraftForSession,
        notify,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(sendText).not.toHaveBeenCalled()
    expect(runDraftUpdater(setDraft)).toBe('把颜色调暖一些')
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', '把颜色调暖一些')
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('取消等待中的动作失败'),
      'error',
    )
  })

  it('取消排队任务抛错时也把消息放回输入框，且不再 settle/send', async () => {
    const settle = vi.fn()
    const sendText = vi.fn()
    const setDraft = vi.fn()
    const writeDraftForSession = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        getQueuedJob: vi.fn(async () => ({
          id: 'job-1',
          status: 'queued',
        })),
        cancelQueuedJob: vi.fn(async () => {
          throw new Error('cancel failed')
        }),
        settleInterruptedSession: settle,
        sendText,
        setDraft,
        writeDraftForSession,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(settle).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(runDraftUpdater(setDraft)).toBe('把颜色调暖一些')
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', '把颜色调暖一些')
  })

  it('目标会话已切走时只写该会话草稿，不动当前草稿', async () => {
    const setDraft = vi.fn()
    const writeDraftForSession = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        isCurrentSession: vi.fn(() => false),
        settleInterruptedSession: vi.fn(async () => ({
          cleanupError: new Error('cleanup failed'),
        })),
        setDraft,
        writeDraftForSession,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(setDraft).not.toHaveBeenCalled()
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', '把颜色调暖一些')
  })

  it('当前已有一半草稿时把放回的消息接在后面，不覆盖', async () => {
    const writeDraftForSession = vi.fn()
    const setDraft = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        settleInterruptedSession: vi.fn(async () => ({
          cleanupError: new Error('cleanup failed'),
        })),
        setDraft,
        writeDraftForSession,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    const updater = setDraft.mock.calls[0]?.[0] as (prev: string) => string
    const merged = updater('已经写了一半的新话')
    expect(merged).toBe('已经写了一半的新话\n\n把颜色调暖一些')
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', merged)
  })

  it('removeQueuedTurn 返回 null 时不再 cancel/settle/send', async () => {
    const cancelQueuedJob = vi.fn()
    const settleInterruptedSession = vi.fn()
    const sendText = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        getQueuedJob: vi.fn(async () => ({
          id: 'job-1',
          status: 'queued',
        })),
        removeQueuedTurn: vi.fn(async () => null),
        cancelQueuedJob,
        settleInterruptedSession,
        sendText,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(cancelQueuedJob).not.toHaveBeenCalled()
    expect(settleInterruptedSession).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })

  it('queuedJob 非 queued 时不 cancel，但 settle/send 正常', async () => {
    const cancelQueuedJob = vi.fn()
    const sendText = vi.fn(async () => undefined)
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        getQueuedJob: vi.fn(async () => ({
          id: 'job-1',
          status: 'completed',
        })),
        cancelQueuedJob,
        sendText,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(cancelQueuedJob).not.toHaveBeenCalled()
    expect(sendText).toHaveBeenCalledTimes(1)
  })

  it('settled.session 和 withoutTurn fallback 都作为发送目标', async () => {
    const withoutTurn = {
      ...session('s1'),
      title: 'without-turn',
    }
    const settledSession = {
      ...session('s1'),
      title: 'settled-session',
    }

    const withSettled = vi.fn(async (_text, target) => {
      expect(target).toMatchObject({ title: 'settled-session' })
    })
    const first = render(
      input({
        statusFor: () => confirmationStatus(),
        removeQueuedTurn: vi.fn(async () => withoutTurn),
        settleInterruptedSession: vi.fn(async () => ({
          session: settledSession,
        })),
        sendText: withSettled,
      }),
    )
    await act(async () => {
      await first.viewRef.current!.guideQueuedTurn(turn())
    })
    expect(withSettled).toHaveBeenCalledTimes(1)

    const withFallback = vi.fn(async (_text, target) => {
      expect(target).toMatchObject({ title: 'without-turn' })
    })
    const second = render(
      input({
        statusFor: () => confirmationStatus(),
        removeQueuedTurn: vi.fn(async () => withoutTurn),
        settleInterruptedSession: vi.fn(async () => ({})),
        sendText: withFallback,
      }),
    )
    await act(async () => {
      await second.viewRef.current!.guideQueuedTurn(turn())
    })
    expect(withFallback).toHaveBeenCalledTimes(1)
  })

  it('send reject 时只发送一次，并把消息放回输入框', async () => {
    const sendText = vi.fn(async () => {
      throw new Error('send failed')
    })
    const removeQueuedTurn = vi.fn(async () => session('s1'))
    const setDraft = vi.fn()
    const writeDraftForSession = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        removeQueuedTurn,
        sendText,
        setDraft,
        writeDraftForSession,
        notify,
      }),
    )
    // 队列项已经摘掉，失败不能再往上抛成「什么都没发生」
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(removeQueuedTurn).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledTimes(1)
    expect(runDraftUpdater(setDraft)).toBe('把颜色调暖一些')
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', '把颜色调暖一些')
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('引导发送失败'),
      'error',
    )
  })

  it('sendText 没发出（返回 undefined）时把消息放回输入框', async () => {
    const setDraft = vi.fn()
    const writeDraftForSession = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        sendText: vi.fn(async () => undefined),
        setDraft,
        writeDraftForSession,
        notify,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(runDraftUpdater(setDraft)).toBe('把颜色调暖一些')
    expect(writeDraftForSession).toHaveBeenCalledWith('s1', '把颜色调暖一些')
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('引导发送失败'),
      'error',
    )
  })

  it('send 成功时不留错误提示、不写草稿', async () => {
    const writeDraftForSession = vi.fn()
    const setDraft = vi.fn()
    const notify = vi.fn()
    const { viewRef } = render(
      input({
        statusFor: () => confirmationStatus(),
        sendText: vi.fn(async () => ({ kind: 'message' })),
        writeDraftForSession,
        setDraft,
        notify,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(writeDraftForSession).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalledWith(
      expect.anything(),
      'error',
    )
  })

  it('promote 失败文案保持原文', async () => {
    const notify = vi.fn()
    const cases = [
      ['has_assets', '带新素材的消息不能中途引导，请等它按队列发送'],
      ['steer_full', '当前任务的引导已达上限'],
      ['awaiting_confirmation', 'Agent 正在等待确认，请重新点击引导'],
      ['active', '这条消息正在发送中，不能转成引导'],
      ['missing', '这条排队消息已经不存在'],
    ] as const
    for (const [reason, message] of cases) {
      const harness = render(
        input({
          notify,
          promoteQueuedTurnToSteer: vi.fn(async () => ({
            ok: false as const,
            reason,
          })),
        }),
      )
      await act(async () => {
        await harness.viewRef.current!.guideQueuedTurn(turn())
      })
      expect(notify).toHaveBeenLastCalledWith(message, 'error')
    }
  })

  /**
   * #914：pump 已经把这条 turn 的文本发出去了（`activeTurnId === turn.id`）。
   * 此时转成引导 = 同一句话再注入一次 ⇒ 必须明确拒绝，并且**不动队列、不重发**。
   */
  it('★★ 正在发送的 turn 被拒（active）：有提示，且不 remove/cancel/settle/send', async () => {
    const notify = vi.fn()
    const removeQueuedTurn = vi.fn()
    const cancelQueuedJob = vi.fn()
    const settleInterruptedSession = vi.fn()
    const sendText = vi.fn()
    const applySessionSnapshot = vi.fn()
    const { viewRef } = render(
      input({
        notify,
        removeQueuedTurn,
        cancelQueuedJob,
        settleInterruptedSession,
        sendText,
        applySessionSnapshot,
        promoteQueuedTurnToSteer: vi.fn(async () => ({
          ok: false as const,
          reason: 'active' as const,
        })),
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      '这条消息正在发送中，不能转成引导',
      'error',
    )
    expect(removeQueuedTurn).not.toHaveBeenCalled()
    expect(cancelQueuedJob).not.toHaveBeenCalled()
    expect(settleInterruptedSession).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(applySessionSnapshot).not.toHaveBeenCalled()
  })

  it('正常 promote 后 apply、cancel job、关菜单、通知', async () => {
    const events: string[] = []
    const notify = vi.fn(() => events.push('notify'))
    const { viewRef } = render(
      input({
        getQueuedJob: vi.fn(async () => ({
          id: 'job-1',
          status: 'queued',
        })),
        promoteQueuedTurnToSteer: vi.fn(async (sessionId) => ({
          ok: true as const,
          session: session(sessionId),
        })),
        applySessionSnapshot: vi.fn(() => events.push('apply')),
        cancelQueuedJob: vi.fn(async () => {
          events.push('cancel')
        }),
        setQueueMenuId: vi.fn(() => events.push('menu')),
        notify,
      }),
    )
    await act(async () => {
      await viewRef.current!.guideQueuedTurn(turn())
    })
    expect(events).toEqual(['apply', 'cancel', 'menu', 'notify'])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      '已转为引导，将在 Agent 下一次动作前应用',
      'info',
    )
  })
})
