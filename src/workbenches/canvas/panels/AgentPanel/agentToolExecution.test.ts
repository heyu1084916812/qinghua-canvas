import { describe, expect, it } from 'vitest'
import {
  AgentToolEffectBlockedError,
  type AgentToolEffectRun,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import type { AgentToolEffect } from '../../../../domain/agent/job'
import {
  createAgentToolExecution,
  type AgentToolExecutionPorts,
  type AgentToolExecutionSession,
} from './agentToolExecution'

const effect: AgentToolEffect = {
  effectKey: 'effect-1',
  stepId: 'step-1',
  toolCallId: 'call-1',
  toolName: 'writeNode',
  argsDigest: 'digest',
  state: 'completed',
  startedAt: 1,
}

const request = { callId: 'call-1', name: 'writeNode', args: { a: 1 } }

interface HarnessInit {
  jobId?: string | undefined
  jobIdAsync?: boolean
  session?: AgentToolExecutionSession | null
  outcome?: AgentToolEffectRun
  runThrows?: unknown
  /** 假账本是否真的调用 execute 并把结果当作 completed 回放。 */
  runExecutes?: boolean
}

const harness = (init: HarnessInit = {}) => {
  const runInputs: Parameters<AgentToolExecutionPorts['run']>[0][] = []
  const notifications: { message: string; tone?: 'info' | 'error' }[] = []
  const getSessionIds: string[] = []
  const resolveSessionIds: string[] = []

  const ports: AgentToolExecutionPorts = {
    resolveJobId: (sessionId) => {
      resolveSessionIds.push(sessionId)
      if (init.jobIdAsync) {
        return Promise.resolve(init.jobId === undefined ? undefined : init.jobId)
      }
      return init.jobId
    },
    getSession: async (sessionId) => {
      getSessionIds.push(sessionId)
      return init.session ?? null
    },
    run: async (input) => {
      runInputs.push(input)
      if (init.runThrows !== undefined) throw init.runThrows
      if (init.runExecutes) {
        return {
          kind: 'completed',
          result: await input.execute(),
          replayed: false,
          effect,
        }
      }
      return init.outcome ?? { kind: 'completed', result: 'ok', replayed: false, effect }
    },
    notify: (message, tone) => {
      notifications.push({ message, ...(tone ? { tone } : {}) })
    },
    createBlockedError: AgentToolEffectBlockedError,
  }

  return {
    execution: createAgentToolExecution(ports),
    runInputs,
    notifications,
    getSessionIds,
    resolveSessionIds,
  }
}

const captureError = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work
  } catch (error) {
    return error
  }
  throw new Error('期望抛出错误，但调用成功了')
}

describe('executeWithLedger', () => {
  it('没有 jobId 时直接执行，不进账本', async () => {
    const {
      execution,
      runInputs,
      notifications,
      getSessionIds,
      resolveSessionIds,
    } = harness()
    let executed = 0

    const result = await execution.executeWithLedger(
      'session-a',
      request,
      async () => {
        executed += 1
        return 'direct'
      },
    )

    expect(result).toBe('direct')
    expect(executed).toBe(1)
    expect(runInputs).toEqual([])
    expect(notifications).toEqual([])
    expect(getSessionIds).toEqual([])
    expect(resolveSessionIds).toEqual(['session-a'])
  })

  it('jobId 需要异步回落到活动 Job 时也照样进账本', async () => {
    const { execution, runInputs } = harness({ jobId: 'job-async', jobIdAsync: true })

    await execution.executeWithLedger('session-a', request, async () => 'ok')

    expect(runInputs).toHaveLength(1)
    expect(runInputs[0].jobId).toBe('job-async')
  })

  it('账本入参逐字段原样传入', async () => {
    const { execution, runInputs } = harness({
      jobId: 'job-1',
      session: { id: 'session-a', taskPlan: { currentStepId: 'step-7' } },
    })
    const execute = async () => 'ok'

    await execution.executeWithLedger('session-a', request, execute)

    expect(runInputs[0]).toEqual({
      jobId: 'job-1',
      stepId: 'step-7',
      toolCallId: 'call-1',
      toolName: 'writeNode',
      args: { a: 1 },
      execute,
    })
  })

  it('没有 taskPlan 时 stepId 记作 unplanned', async () => {
    const { execution, runInputs } = harness({
      jobId: 'job-1',
      session: { id: 'session-a' },
    })

    await execution.executeWithLedger('session-a', request, async () => 'ok')

    expect(runInputs[0].stepId).toBe('unplanned')
  })

  it('会话读不到时 stepId 也记作 unplanned', async () => {
    const { execution, runInputs } = harness({ jobId: 'job-1', session: null })

    await execution.executeWithLedger('session-a', request, async () => 'ok')

    expect(runInputs[0].stepId).toBe('unplanned')
  })

  it('completed 直接返回结果，不发提示', async () => {
    const { execution, notifications } = harness({
      jobId: 'job-1',
      outcome: { kind: 'completed', result: { written: 2 }, replayed: false, effect },
    })

    const result = await execution.executeWithLedger(
      'session-a',
      request,
      async () => 'ignored',
    )

    expect(result).toEqual({ written: 2 })
    expect(notifications).toEqual([])
  })

  it('completed + replayed 发一条 info 提示并返回原结果', async () => {
    const { execution, notifications } = harness({
      jobId: 'job-1',
      outcome: { kind: 'completed', result: 'cached', replayed: true, effect },
    })

    const result = await execution.executeWithLedger(
      'session-a',
      request,
      async () => 'ignored',
    )

    expect(result).toBe('cached')
    expect(notifications).toEqual([
      {
        message: '已复用这次工具调用的持久结果，没有重复执行或扣费',
        tone: 'info',
      },
    ])
  })

  it('pending 转 needs_attention，并把原 outcome 透传出去', async () => {
    const outcome: AgentToolEffectRun = {
      kind: 'pending',
      reason: '上一次还没回来',
      effect,
    }
    const { execution } = harness({ jobId: 'job-1', outcome })

    const error = await captureError(
      execution.executeWithLedger('session-a', request, async () => 'ok'),
    )

    expect(error).toBeInstanceOf(AgentToolEffectBlockedError)
    const blocked = error as AgentToolEffectBlockedError
    expect(blocked.message).toBe('上一次还没回来')
    expect(blocked.status).toBe('needs_attention')
    expect(blocked.outcome).toBe(outcome)
  })

  it('conflict 按 failed 处理，用 reason 当消息', async () => {
    const outcome: AgentToolEffectRun = {
      kind: 'conflict',
      reason: '同样 callId 换了参数',
      effect,
    }
    const { execution } = harness({ jobId: 'job-1', outcome })

    const error = await captureError(
      execution.executeWithLedger('session-a', request, async () => 'ok'),
    )

    const blocked = error as AgentToolEffectBlockedError
    expect(blocked).toBeInstanceOf(AgentToolEffectBlockedError)
    expect(blocked.message).toBe('同样 callId 换了参数')
    expect(blocked.status).toBe('failed')
    expect(blocked.outcome).toBe(outcome)
  })

  it('failed 按 failed 处理，用 error 当消息', async () => {
    const outcome: AgentToolEffectRun = {
      kind: 'failed',
      error: '上游 500',
      replayed: false,
      effect,
    }
    const { execution } = harness({ jobId: 'job-1', outcome })

    const error = await captureError(
      execution.executeWithLedger('session-a', request, async () => 'ok'),
    )

    const blocked = error as AgentToolEffectBlockedError
    expect(blocked.message).toBe('上游 500')
    expect(blocked.status).toBe('failed')
    expect(blocked.outcome).toBe(outcome)
  })

  it('账本自己抛错时原样向上抛，不包装', async () => {
    const boom = new Error('账本坏了')
    const { execution, notifications } = harness({ jobId: 'job-1', runThrows: boom })

    const error = await captureError(
      execution.executeWithLedger('session-a', request, async () => 'ok'),
    )

    expect(error).toBe(boom)
    expect(notifications).toEqual([])
  })

  it('执行体抛错时交给账本处理，不在这里吞掉', async () => {
    const { execution, runInputs } = harness({ jobId: 'job-1' })
    const boom = new Error('执行失败')
    const execute = async () => {
      throw boom
    }

    await execution.executeWithLedger('session-a', request, execute)

    // 账本拿到的就是原 execute；错误策略由账本决定（本测试的假账本直接成功）。
    expect(runInputs[0].execute).toBe(execute)
  })
})

describe('executeConfirmedWithLedger', () => {
  it('用会话 id 进账本，并把同一个会话对象交给执行体', async () => {
    const session = { id: 'session-b', taskPlan: { currentStepId: 'step-2' } }
    const { execution, runInputs } = harness({
      jobId: 'job-9',
      session,
      runExecutes: true,
    })
    const seen: AgentToolExecutionSession[] = []

    const result = await execution.executeConfirmedWithLedger(
      session,
      request,
      async (target) => {
        seen.push(target)
        return 'confirmed'
      },
    )

    expect(result).toBe('confirmed')
    expect(seen).toEqual([session])
    expect(runInputs[0].jobId).toBe('job-9')
    expect(runInputs[0].stepId).toBe('step-2')
    expect(runInputs[0].toolCallId).toBe('call-1')
  })

  it('没有 jobId 时不进账本，但仍调用执行体', async () => {
    const session = { id: 'session-b' }
    const { execution, runInputs } = harness()
    let executed = 0

    const result = await execution.executeConfirmedWithLedger(
      session,
      request,
      async () => {
        executed += 1
        return 'direct'
      },
    )

    expect(result).toBe('direct')
    expect(executed).toBe(1)
    expect(runInputs).toEqual([])
  })
})
