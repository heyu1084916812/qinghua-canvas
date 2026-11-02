import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  claimSessionActivity,
  isSessionActivityActive,
  releaseSessionActivity,
} from '../../../../features/canvas/agent/sessionActivity'
import {
  useAgentQueueController,
  type AgentQueueControllerInput,
} from './useAgentQueueController'

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
    refresh: vi.fn(async () => [session]),
    notify: vi.fn(),
    queuePumpingRef: { current: new Set<string>() },
    queuePumpRef: { current: vi.fn() },
    ...patch,
  }
}

describe('useAgentQueueController', () => {
  afterEach(() => {
    releaseSessionActivity(session.id)
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
    expect(props.applySessionSnapshot).toHaveBeenCalled()
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
})
