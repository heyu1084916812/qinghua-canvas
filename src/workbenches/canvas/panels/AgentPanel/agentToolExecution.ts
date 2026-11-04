import type {
  AgentToolEffectBlockedError,
  AgentToolEffectRun,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'

/** 账本拒绝执行时带的状态分支（`completed` 不会走到这）。 */
export type AgentToolEffectBlockedOutcome = Exclude<
  AgentToolEffectRun,
  { kind: 'completed' }
>

/** 账本执行只需要会话上的计划进度，不读别的字段。 */
export interface AgentToolExecutionSession {
  id: string
  taskPlan?: { currentStepId?: string }
}

export interface AgentToolExecutionPorts<
  S extends AgentToolExecutionSession = AgentToolExecutionSession,
> {
  /**
   * 这次工具调用归属哪个 Job：先看当前回合绑定的 Job，没有才回落到
   * 该会话的活动 Job。返回同步字符串时**不会**触发回落查询（与原实现一致）。
   */
  resolveJobId: (
    sessionId: string,
  ) => string | undefined | Promise<string | undefined>
  /** 读会话最新快照，只为拿 `taskPlan.currentStepId`。 */
  getSession: (sessionId: string) => Promise<S | null>
  /** `AgentToolEffectLedger.run` 端口。 */
  run: (input: {
    jobId: string
    stepId: string
    toolCallId: string
    toolName: string
    args: unknown
    execute: () => Promise<unknown>
  }) => Promise<AgentToolEffectRun>
  notify: (message: string, tone?: 'info' | 'error') => void
  /** 错误类型由调用方给，模块不自己定义错误语义。 */
  createBlockedError: new (
    message: string,
    status: 'needs_attention' | 'failed',
    outcome: AgentToolEffectBlockedOutcome,
  ) => AgentToolEffectBlockedError
}

export interface AgentToolExecution<
  S extends AgentToolExecutionSession = AgentToolExecutionSession,
> {
  executeWithLedger: (
    sessionId: string,
    request: AgentToolRequest,
    execute: () => Promise<unknown>,
  ) => Promise<unknown>
  executeConfirmedWithLedger: (
    session: S,
    request: AgentToolRequest,
    executeConfirmed: (session: S) => Promise<unknown>,
  ) => Promise<unknown>
}

/**
 * 确认型工具只执行一次。
 *
 * 工具结果写在同一 Job 的不可变事件流水里，应用崩溃或确认按钮被再次触发时：
 * - 已完成：直接回放上次结果；
 * - 已开始未完成：转 needs_attention，不自动重发；
 * - 相同 callId 却换了参数：按失败处理，避免把两次不同操作混成一次。
 *
 * 这里只做编排：Job / 会话 / 账本 / 通知全部经端口拿，故不 import React 或任何单例。
 */
export function createAgentToolExecution<
  S extends AgentToolExecutionSession = AgentToolExecutionSession,
>(ports: AgentToolExecutionPorts<S>): AgentToolExecution<S> {
  const executeWithLedger = async (
    sessionId: string,
    request: AgentToolRequest,
    execute: () => Promise<unknown>,
  ): Promise<unknown> => {
    const resolvedJobId = ports.resolveJobId(sessionId)
    const jobId =
      typeof resolvedJobId === 'string'
        ? resolvedJobId
        : await resolvedJobId
    /** 没有 Job = 这次调用不属于任何可回放的回合，直接执行，不进账本。 */
    if (!jobId) {
      return execute()
    }
    const latest = await ports.getSession(sessionId)
    const stepId = latest?.taskPlan?.currentStepId ?? 'unplanned'
    const outcome = await ports.run({
      jobId,
      stepId,
      toolCallId: request.callId,
      toolName: request.name,
      args: request.args,
      execute,
    })
    if (outcome.kind === 'completed') {
      if (outcome.replayed) {
        ports.notify(
          '已复用这次工具调用的持久结果，没有重复执行或扣费',
          'info',
        )
      }
      return outcome.result
    }
    if (outcome.kind === 'pending') {
      throw new ports.createBlockedError(
        outcome.reason,
        'needs_attention',
        outcome,
      )
    }
    throw new ports.createBlockedError(
      outcome.kind === 'conflict' ? outcome.reason : outcome.error,
      'failed',
      outcome,
    )
  }

  return {
    executeWithLedger,
    executeConfirmedWithLedger: (session, request, executeConfirmed) =>
      executeWithLedger(session.id, request, () =>
        executeConfirmed(session),
      ),
  }
}
