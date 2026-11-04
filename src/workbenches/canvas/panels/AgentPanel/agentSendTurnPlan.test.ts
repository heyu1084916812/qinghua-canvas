import { describe, expect, it } from 'vitest'
import type {
  AgentTaskPlan,
  AgentTaskStepStatus,
} from '../../../../domain/agent/taskPlan'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { AgentTurnOrigin } from '../../../../features/shared/agent/AgentController'
import { IDLE_STATUS } from './AgentActivityViews'
import {
  failureStatus,
  failureTurnPayload,
  sendTurnSeed,
  shouldClearTaskPlan,
} from './agentSendTurnPlan'

function planWith(status: AgentTaskStepStatus): AgentTaskPlan {
  return {
    id: 'plan-1',
    title: '两步画一张海报',
    steps: [{ id: 'step-1', title: '出图', status }],
    currentStepId: 'step-1',
    createdAt: 1,
    updatedAt: 1,
  }
}

function session(taskPlan?: AgentTaskPlan): AgentSession {
  return {
    id: 's1',
    projectId: 'p1',
    title: '会话 s1',
    channelId: '',
    model: 'GPT-6 Astra',
    messages: [],
    pendingSteers: [],
    queuedTurns: [],
    createdAt: 1,
    updatedAt: 1,
    ...(taskPlan ? { taskPlan } : {}),
  }
}

describe('shouldClearTaskPlan：发送前是否清掉旧计划', () => {
  const cases: Array<{
    label: string
    step: AgentTaskStepStatus | null
    expected: boolean
  }> = [
    { label: '没有计划 → 不清、也不写库', step: null, expected: false },
    { label: '计划进行中 → 保留（准备阶段还要用）', step: 'pending', expected: false },
    { label: '计划进行中（in_progress）→ 保留', step: 'in_progress', expected: false },
    { label: '计划已完成 → 清', step: 'done', expected: true },
    { label: '计划已失败 → 清', step: 'failed', expected: true },
    { label: '计划全部跳过 → 视为完成、清', step: 'skipped', expected: true },
  ]

  it.each(cases)('$label', ({ step, expected }) => {
    const target = session(step ? planWith(step) : undefined)

    expect(shouldClearTaskPlan(target)).toBe(expected)
    // 种子必须与判定同源，避免两处各写一遍口径。
    expect(
      sendTurnSeed({ session: target, text: '继续', actualTurnId: 'turn-1' })
        .clearTaskPlan,
    ).toBe(expected)
  })
})

describe('sendTurnSeed：origin 初值', () => {
  it('只有 turnId / queueTurnId，绝不提前塞 jobId / messageRevision', () => {
    const seed = sendTurnSeed({
      session: session(),
      text: '画一张海报',
      actualTurnId: 'turnmsg-1',
    })

    expect(seed.turnOrigin).toEqual({
      turnId: 'turnmsg-1',
      queueTurnId: undefined,
    })
    // jobId 等 onRouteReady、messageRevision 等 onPersisted，提前塞会让 failTurn
    // / settle 读到假 origin。
    expect(Object.keys(seed.turnOrigin).sort()).toEqual([
      'queueTurnId',
      'turnId',
    ])
    expect('jobId' in seed.turnOrigin).toBe(false)
    expect('messageRevision' in seed.turnOrigin).toBe(false)
  })

  it('队列回合：queueTurnId 原样带上，turnId 仍是本次实际回合 id', () => {
    const seed = sendTurnSeed({
      session: session(),
      text: '继续',
      actualTurnId: 'turnmsg-2',
      queueTurnId: 'queued-9',
    })

    expect(seed.turnOrigin).toEqual({
      turnId: 'turnmsg-2',
      queueTurnId: 'queued-9',
    })
  })

  it('正文不参与种子：空串与长文得到同一份初值', () => {
    const short = sendTurnSeed({
      session: session(),
      text: '',
      actualTurnId: 'turn-1',
    })
    const long = sendTurnSeed({
      session: session(),
      text: '很长的正文…'.repeat(50),
      actualTurnId: 'turn-1',
    })

    expect(long).toEqual(short)
  })

  it('返回的 origin 是新对象（后续 onPersisted / onRouteReady 要就地补字段）', () => {
    const a = sendTurnSeed({
      session: session(),
      text: 'x',
      actualTurnId: 'turn-1',
    }).turnOrigin
    const b = sendTurnSeed({
      session: session(),
      text: 'x',
      actualTurnId: 'turn-1',
    }).turnOrigin

    expect(a).not.toBe(b)
    a.messageRevision = 3
    expect(b.messageRevision).toBeUndefined()
  })
})

describe('failureStatus：失败后的展示状态', () => {
  it('用户自己停的 → 回 idle（不弹红字），且复用同一个 IDLE_STATUS 常量', () => {
    expect(failureStatus(true, '路由准备失败')).toBe(IDLE_STATUS)
  })

  it('其它失败 → error，文案原样透出', () => {
    expect(failureStatus(false, '用户消息或路由准备失败：boom')).toEqual({
      kind: 'error',
      message: '用户消息或路由准备失败：boom',
    })
  })
})

describe('failureTurnPayload：failTurn 的入参', () => {
  const origin: AgentTurnOrigin = {
    turnId: 'turn-1',
    queueTurnId: undefined,
  }

  it('reason 取文案、phase 原样、aborted 原样、origin 同一对象', () => {
    const payload = failureTurnPayload({
      message: '上下文准备失败',
      phase: 'prepare_context',
      aborted: false,
      origin,
    })

    expect(payload).toEqual({
      reason: '上下文准备失败',
      phase: 'prepare_context',
      aborted: false,
      origin,
    })
    expect(payload.origin).toBe(origin)
  })

  it('abort 恰好发生在 failTurn 期间：payload 记 false，状态仍回 idle', () => {
    // 这不是冗余测试：runSendText 里 payload 与 status 各读一次 signal.aborted，
    // 中间隔着 failTurn 的 await。合成一次读取就会把这个语义改掉。
    const payload = failureTurnPayload({
      message: '路由失败',
      phase: 'route',
      aborted: false,
      origin,
    })

    expect(payload.aborted).toBe(false)
    expect(failureStatus(true, '路由失败')).toBe(IDLE_STATUS)
  })
})
