import { describe, expect, it, vi } from 'vitest'
import type { AgentJob } from '../../../../domain/agent/job'
import { createAgentToolSafety } from './agentToolSafety'

const job: AgentJob = {
  id: 'ajob_1',
  sessionId: 's1',
  projectId: 'p1',
  turnId: 't1',
  status: 'completed',
  revision: 1,
  createdAt: 1,
  updatedAt: 2,
}

describe('AgentToolSafety · readOperation', () => {
  it('按 requestId 查原操作，不调用执行器', async () => {
    const toolEffect = vi.fn(async () => ({
      effectKey: 'agent:ajob_1:step-1:call-1',
      stepId: 'step-1',
      toolCallId: 'call-1',
      toolName: 'runNode',
      argsDigest: 'digest',
      state: 'started' as const,
      startedAt: 10,
    }))
    const safety = createAgentToolSafety({
      sessionId: 's1',
      jobs: {
        get: async () => job,
        list: async () => [job],
        toolEffect,
      },
    })
    const result = await safety.readOperation('agent:ajob_1:step-1:call-1')
    expect(result).toMatchObject({
      ok: true,
      status: 'pending',
      jobId: 'ajob_1',
    })
    expect(toolEffect).toHaveBeenCalledWith('ajob_1', 'agent:ajob_1:step-1:call-1')
  })

  it('找不到时如实返回，不伪造完成', async () => {
    const safety = createAgentToolSafety({
      sessionId: 's1',
      jobs: {
        get: async () => job,
        list: async () => [job],
        toolEffect: async () => null,
      },
    })
    await expect(safety.readOperation('agent:ajob_1:step-1:missing')).resolves.toMatchObject({
      ok: false,
    })
  })

  it('不能读取其他会话的 Job', async () => {
    const safety = createAgentToolSafety({
      sessionId: 's2',
      jobs: {
        get: async () => job,
        list: async () => [],
        toolEffect: async () => {
          throw new Error('不应该查询其他会话')
        },
      },
    })
    await expect(safety.readOperation('agent:ajob_1:step-1:call-1')).resolves.toMatchObject({
      ok: false,
    })
  })
})
