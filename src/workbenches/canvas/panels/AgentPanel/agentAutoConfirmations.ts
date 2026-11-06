import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  confirmationRequiresExplicitApproval,
  confirmationRunsGeneration,
} from '../../../../domain/agent/confirmation'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type {
  AgentController,
  AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
import type {
  AgentLoopDeps,
  AgentLoopOutcome,
  AgentToolRequest,
} from '../../agent/agentLoop'

export interface AgentAutoConfirmationInput {
  session: AgentSession
  initial: AgentLoopOutcome
  loopDeps: AgentLoopDeps
  /** 实时读取开关；运行中切换自动模式要立即影响后续步骤。 */
  autoRun: () => boolean
  maxSteps: number
  turnOrigin: () => AgentTurnOrigin
  transitionSessionJob: AgentController['transition']
  executeConfirmedTool: (
    session: AgentSession,
    request: AgentToolRequest,
  ) => Promise<unknown>
  finishConfirmedTool: AgentController['finishConfirmedTool']
  onMessages: (messages: ChatMessage[]) => void
  setStatus: (
    sessionId: string,
    status: { kind: 'executing'; tool?: string },
  ) => void
  resumeAgentTurn: (
    history: readonly ChatMessage[],
    callId: string,
    payload: unknown,
    deps: AgentLoopDeps,
    toolName?: string,
  ) => Promise<AgentLoopOutcome>
}

/**
 * 自动模式下的确认续跑。
 *
 * 只自动通过非显式批准工具；每次仍从当前回合 provider 取 Job / turn origin，
 * 不按 sessionId 现找新 Job。循环、恢复和工具执行均复用传入端口。
 */
export async function continueAgentAutoConfirmations(
  input: AgentAutoConfirmationInput,
): Promise<AgentLoopOutcome> {
  let outcome = input.initial
  let autoSteps = 0
  while (
    outcome.kind === 'confirm' &&
    input.autoRun() &&
    !confirmationRequiresExplicitApproval(
      outcome.request.name,
      outcome.request.args,
      { autoRun: input.autoRun() },
    ) &&
    autoSteps < input.maxSteps
  ) {
    autoSteps += 1
    const turnOrigin = input.turnOrigin()
    const runsGeneration = confirmationRunsGeneration(
      outcome.request.name,
    )
    if (runsGeneration) {
      await input.transitionSessionJob(
        input.session.id,
        'waiting_generation',
        'generation_started',
        { pendingCallId: outcome.request.callId },
        { tool: outcome.request.name, auto: true },
        turnOrigin,
      )
    }
    input.setStatus(input.session.id, {
      kind: 'executing',
      tool: outcome.request.name,
    })
    const done = await input.executeConfirmedTool(
      input.session,
      outcome.request,
    )
    input.onMessages(outcome.messages)
    if (runsGeneration) {
      await input.finishConfirmedTool(
        input.session.id,
        outcome.request,
        turnOrigin,
      )
    }
    outcome = await input.resumeAgentTurn(
      outcome.messages,
      outcome.request.callId,
      done,
      input.loopDeps,
      outcome.request.name,
    )
  }
  if (
    outcome.kind === 'confirm' &&
    input.autoRun() &&
    autoSteps >= input.maxSteps &&
    !confirmationRequiresExplicitApproval(
      outcome.request.name,
      outcome.request.args,
      { autoRun: input.autoRun() },
    )
  ) {
    outcome = {
      kind: 'stopped',
      reason:
        `自动执行已连续完成 ${input.maxSteps} 个动作，已安全暂停；` +
        '点击“继续任务”可接着执行，不会把下一步变成新的付费确认卡。',
      messages: outcome.messages,
      checkpoint: {
        kind: 'max_steps',
        maxSteps: input.maxSteps,
        completedSteps: input.maxSteps,
      },
    }
  }
  return outcome
}
