import { describe, expect, it, vi } from 'vitest'
import type { AgentTaskPlan } from '../../../../domain/agent/taskPlan'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { createAgentToolPlanPorts } from './agentToolPlanPorts'

function plan(id = 'plan-1'): AgentTaskPlan {
  return {
    id,
    title: '两步画一张海报',
    steps: [{ id: 'step-1', title: '出图', status: 'pending' }],
    createdAt: 1,
    updatedAt: 1,
  }
}

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

function harness(options: {
  updated?: AgentSession | null
  currentId?: string | null
  savedPlan?: AgentTaskPlan
} = {}) {
  const events: string[] = []
  const savedPlan = options.savedPlan ?? plan('plan-saved')
  const updated =
    options.updated === undefined
      ? { ...session('s1'), taskPlan: savedPlan }
      : options.updated
  const updateFields = vi.fn(async () => {
    events.push('updateFields')
    return updated
  })
  const setList = vi.fn(() => {
    events.push('setList')
  })
  const setCurrent = vi.fn(() => {
    events.push('setCurrent')
  })
  const getSession = vi.fn(async (): Promise<AgentSession | null> =>
    session('s1'),
  )
  const ports = createAgentToolPlanPorts({
    sessionId: 's1',
    getSession,
    updateFields,
    trackRun: (work) => work(),
    setList,
    setCurrent,
    currentIdRef: { current: options.currentId ?? 's1' },
  })
  return {
    ports,
    events,
    updateFields,
    setList,
    setCurrent,
    getSession,
    savedPlan,
  }
}

describe('createAgentToolPlanPorts / 顺序', () => {
  it('落库 → 投影列表 → 投影当前会话，顺序固定', async () => {
    const h = harness()

    const saved = await h.ports.save(plan())

    expect(h.events).toEqual(['updateFields', 'setList', 'setCurrent'])
    expect(h.updateFields).toHaveBeenCalledWith('s1', {
      taskPlan: plan(),
    })
    // 返回的是**落库后会话上的那份**，不是入参对象
    expect(saved).toBe(h.savedPlan)
  })

  it('updateFields 返回 null：一个投影都不做，save 也返回 null', async () => {
    const h = harness({ updated: null })

    const saved = await h.ports.save(plan())

    expect(h.events).toEqual(['updateFields'])
    expect(h.setList).not.toHaveBeenCalled()
    expect(h.setCurrent).not.toHaveBeenCalled()
    expect(saved).toBeNull()
  })

  it('目标已不是当前会话：只同步列表，不 setCurrent', async () => {
    const h = harness({ currentId: 's2' })

    await h.ports.save(plan())

    expect(h.events).toEqual(['updateFields', 'setList'])
    expect(h.setCurrent).not.toHaveBeenCalled()
  })

  it('整段被 trackRun 包住：关闭后写库会被直接拒绝', async () => {
    const closed = new Error('lifecycle closed')
    const updateFields = vi.fn(async () => session('s1'))
    const ports = createAgentToolPlanPorts({
      sessionId: 's1',
      getSession: vi.fn(async () => session('s1')),
      updateFields,
      trackRun: () => Promise.reject(closed),
      setList: vi.fn(),
      setCurrent: vi.fn(),
      currentIdRef: { current: 's1' },
    })

    await expect(ports.save(plan())).rejects.toBe(closed)
    expect(updateFields).not.toHaveBeenCalled()
  })
})

describe('createAgentToolPlanPorts / 读取', () => {
  it('get 走会话仓储并只取 taskPlan', async () => {
    const h = harness()
    h.getSession.mockResolvedValue({
      ...session('s1'),
      taskPlan: plan('plan-9'),
    })

    await expect(h.ports.get()).resolves.toEqual(plan('plan-9'))
    expect(h.getSession).toHaveBeenCalledWith('s1')
  })

  it('会话读不到时 get 返回 undefined', async () => {
    const h = harness()
    h.getSession.mockResolvedValue(null)

    await expect(h.ports.get()).resolves.toBeUndefined()
  })
})
