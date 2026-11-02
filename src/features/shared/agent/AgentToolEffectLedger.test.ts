import { describe, expect, it, vi } from 'vitest'
import { fingerprintHex } from '../../../domain/shared/hash'
import { createMemoryPlatform } from '../../../platform/memory'
import { createAgentJobStore } from '../../../state/agent/jobStore'
import { createAgentToolEffectLedger } from './AgentToolEffectLedger'

async function setup() {
  const jobs = createAgentJobStore(createMemoryPlatform().storage)
  const { job } = await jobs.create({
    sessionId: 's1',
    projectId: 'p1',
    turnId: 'turn-1',
  })
  return { jobs, job, ledger: createAgentToolEffectLedger(jobs) }
}

describe('AgentToolEffectLedger', () => {
  it('executes once and replays the persisted result', async () => {
    const { job, ledger } = await setup()
    const execute = vi.fn(async () => ({ ok: true, nodeId: 'node-1' }))
    const input = {
      jobId: job.id,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      args: { nodeIds: ['node-1'] },
      execute,
    }

    await expect(ledger.run(input)).resolves.toMatchObject({
      kind: 'completed',
      result: { ok: true, nodeId: 'node-1' },
      replayed: false,
    })
    await expect(ledger.run(input)).resolves.toMatchObject({
      kind: 'completed',
      result: { ok: true, nodeId: 'node-1' },
      replayed: true,
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('does not rerun an effect that started but never finished', async () => {
    const { jobs, job, ledger } = await setup()
    await jobs.claimToolEffect({
      jobId: job.id,
      effectKey: `agent:${job.id}:step-1:call-1`,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      argsDigest: fingerprintHex(JSON.stringify(null)),
    })
    const execute = vi.fn()

    await expect(
      ledger.run({
        jobId: job.id,
        stepId: 'step-1',
        toolCallId: 'call-1',
        toolName: 'runNode',
        args: null,
        execute,
      }),
    ).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('不会自动重发'),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('blocks every new tool effect while one earlier effect is unresolved', async () => {
    const { jobs, job, ledger } = await setup()
    await jobs.claimToolEffect({
      jobId: job.id,
      effectKey: `agent:${job.id}:step-1:call-1`,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      argsDigest: fingerprintHex(JSON.stringify({})),
    })
    const execute = vi.fn()

    await expect(
      ledger.run({
        jobId: job.id,
        stepId: 'step-1',
        toolCallId: 'call-2',
        toolName: 'runFrom',
        args: {},
        execute,
      }),
    ).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('已经开始但结果未知'),
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('有副作用的工具执行抛错时停在待核对，不自动重试', async () => {
    const { job, ledger } = await setup()
    const input = {
      jobId: job.id,
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      args: {},
    }
    await expect(
      ledger.run({
        ...input,
        execute: async () => {
          throw new Error('渠道超时，结果未知')
        },
      }),
    ).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('无法确认是否已经生效'),
    })
    await expect(
      ledger.run({ ...input, execute: vi.fn() }),
    ).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('不会自动重发'),
    })
  })

  it('纯读工具的真实执行错误仍可记 failed 并回放', async () => {
    const { job, ledger } = await setup()
    const input = {
      jobId: job.id,
      stepId: 'step-1',
      toolCallId: 'read-1',
      toolName: 'readGraph',
      args: {},
    }
    await expect(
      ledger.run({
        ...input,
        execute: async () => {
          throw new Error('画布读取失败')
        },
      }),
    ).resolves.toMatchObject({
      kind: 'failed',
      error: '画布读取失败',
      replayed: false,
    })
    await expect(
      ledger.run({ ...input, execute: vi.fn() }),
    ).resolves.toMatchObject({
      kind: 'failed',
      error: '画布读取失败',
      replayed: true,
    })
  })

  it('工具已执行但完成账本写失败时进入待核对，绝不改写成可重试失败', async () => {
    const { jobs, job } = await setup()
    const completeError = vi
      .spyOn(jobs, 'completeToolEffect')
      .mockRejectedValueOnce(new Error('账本磁盘已满'))
    const ledger = createAgentToolEffectLedger(jobs)
    const execute = vi.fn(async () => ({ ok: true, createdNodeIds: ['n1'] }))
    const input = {
      jobId: job.id,
      stepId: 'step-1',
      toolCallId: 'call-ledger',
      toolName: 'applyPlan',
      args: {},
      execute,
    }

    await expect(ledger.run(input)).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('完成结果写入账本失败'),
    })
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(
      ledger.run({ ...input, execute: vi.fn() }),
    ).resolves.toMatchObject({
      kind: 'pending',
      reason: expect.stringContaining('不会自动重发'),
    })
    completeError.mockRestore()
  })
})
