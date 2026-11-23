import type { AgentJobStore } from '../../../../state/agent/jobStore'

export interface AgentToolSafety {
  readOperation: (requestId: string) => Promise<unknown>
}

function jobIdFromRequestId(requestId: string): string | null {
  const parts = requestId.split(':')
  return parts[0] === 'agent' && parts[1] ? parts[1] : null
}

/**
 * 超时恢复只查持久工具账本，不调用任何工具执行器。
 * requestId 由 agentToolExecution 用 jobId + stepId + toolCallId 生成；
 * 优先直接解出 jobId，旧格式或手工编号才回退到当前会话的 Job 列表。
 */
export function createAgentToolSafety(input: {
  sessionId: string
  jobs: Pick<AgentJobStore, 'get' | 'list' | 'toolEffect'>
}): AgentToolSafety {
  return {
    async readOperation(requestId) {
      const id = requestId.trim()
      if (!id) return { ok: false, error: '缺少 requestId' }
      const direct = jobIdFromRequestId(id)
      const candidates = direct
        ? [await input.jobs.get(direct)]
        : await input.jobs.list(input.sessionId)
      for (const job of candidates) {
        if (!job || job.sessionId !== input.sessionId) continue
        const effect = await input.jobs.toolEffect(job.id, id)
        if (!effect) continue
        return {
          ok: true,
          requestId: id,
          jobId: job.id,
          status:
            effect.state === 'completed'
              ? 'completed'
              : effect.state === 'failed'
                ? 'failed'
                : 'pending',
          operation: effect,
          note:
            effect.state === 'started'
              ? '操作已经开始但还没有持久完成回执。为避免重复扣费或重复写画布，不要重新提交。'
              : undefined,
        }
      }
      return {
        ok: false,
        error: `没有找到请求编号「${id}」对应的操作；它可能尚未落账，或不属于当前会话。`,
      }
    },
  }
}
