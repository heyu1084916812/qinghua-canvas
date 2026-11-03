import type { ChatMessage, ToolDeclaration } from '../../../../domain/shared/execution/types'
import type { AgentToolRequest } from '../../../../domain/agent/toolRequest'
import type {
  AgentController,
  AgentTurnOrigin,
} from '../../../../features/shared/agent/AgentController'
import {
  AgentToolEffectBlockedError,
} from '../../../../features/shared/agent/AgentToolEffectLedger'
import { createId } from '../../../../shared/id'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import {
  confirmationRunsGeneration,
} from '../../../../domain/agent/confirmation'
import {
  errText,
  type AgentLoopDeps,
  type AgentLoopOutcome,
} from '../../agent/agentLoop'
import type {
  AgentOutcomeCoordinationResult,
} from './agentOutcomeCoordinator'

type AgentConfirmationStatus =
  | { kind: 'thinking' }
  | { kind: 'executing'; tool?: string }
  | { kind: 'error'; message: string }

export interface AgentConfirmationLoopDepsInput {
  session: AgentSession
  operationId: string
  toolMode: 'native' | 'json'
  visualNodeIds: readonly string[]
  turnTools: readonly ToolDeclaration[]
  turnController: AbortController
}

export interface AgentConfirmationRunInput {
  session: AgentSession
  request: AgentToolRequest
  messages: readonly ChatMessage[]
  /** 本回合创建时的 Job / queue / turn / revision 身份。 */
  turnOrigin: () => AgentTurnOrigin
  beginConfirmation: AgentController['beginConfirmation']
  finishConfirmedTool: AgentController['finishConfirmedTool']
  executeConfirmedTool: (
    session: AgentSession,
    request: AgentToolRequest,
  ) => Promise<unknown>
  createLoopDeps: (
    input: AgentConfirmationLoopDepsInput,
  ) => AgentLoopDeps
  toolMode: () => 'native' | 'json'
  turnTools: () => readonly ToolDeclaration[]
  resumeAgentTurn: (
    history: readonly ChatMessage[],
    callId: string,
    payload: unknown,
    deps: AgentLoopDeps,
    toolName?: string,
  ) => Promise<AgentLoopOutcome>
  continueAutoConfirmations: (
    session: AgentSession,
    initial: AgentLoopOutcome,
    loopDeps: AgentLoopDeps,
    onMessages: (messages: ChatMessage[]) => void,
  ) => Promise<AgentLoopOutcome>
  handleOutcome: (
    session: AgentSession,
    outcome: AgentLoopOutcome,
    persistedTurn: undefined,
    outcomeController: AbortController,
  ) => Promise<AgentOutcomeCoordinationResult>
  settleSessionOutcome: (
    sessionId: string,
    outcome: AgentLoopOutcome | { kind: 'error' },
    origin?: AgentTurnOrigin,
  ) => Promise<void>
  transitionSessionJob: AgentController['transition']
  setAbortController: (controller: AbortController) => void
  setStatus: (status: AgentConfirmationStatus) => void
  isCurrentSession: () => boolean
  setMessages: (messages: ChatMessage[]) => void
  createAbortController?: () => AbortController
}

export type AgentConfirmationRunResult =
  | AgentOutcomeCoordinationResult
  | 'aborted'
  | 'needs_attention'
  | 'failed'

function latestUserImageNodeIds(
  messages: readonly ChatMessage[],
): string[] {
  const ids =
    [...messages]
      .reverse()
      .find((message) => message.role === 'user')
      ?.imageNodeIds ?? []
  return [...new Set(ids)]
}

/**
 * 执行一张人工确认卡，并把工具结果续跑回模型。
 *
 * 本函数只接收端口，不读取 React refs/state；确认卡仍是 Controller / SessionStore
 * 的真相，工具副作用仍经过持久账本。
 */
export async function runAgentConfirmation(
  input: AgentConfirmationRunInput,
): Promise<AgentConfirmationRunResult> {
  const confirmationAbort =
    input.createAbortController?.() ?? new AbortController()
  let confirmationOrigin: AgentTurnOrigin = {}
  input.setAbortController(confirmationAbort)
  try {
    confirmationOrigin = input.turnOrigin()
    await input.beginConfirmation(
      input.session.id,
      input.request,
      confirmationOrigin,
    )
    input.setStatus({
      kind: 'executing',
      tool: input.request.name,
    })
    const result = await input.executeConfirmedTool(
      input.session,
      input.request,
    )
    const currentLoopDeps = input.createLoopDeps({
      session: input.session,
      operationId: createId('op'),
      toolMode: input.toolMode(),
      visualNodeIds: latestUserImageNodeIds(input.messages),
      turnTools: input.turnTools(),
      turnController: confirmationAbort,
    })
    if (confirmationRunsGeneration(input.request.name)) {
      await input.finishConfirmedTool(
        input.session.id,
        input.request,
        confirmationOrigin,
      )
    }
    input.setStatus({ kind: 'thinking' })
    const resumed = await input.resumeAgentTurn(
      input.messages,
      input.request.callId,
      result,
      currentLoopDeps,
      input.request.name,
    )
    const outcome = await input.continueAutoConfirmations(
      input.session,
      resumed,
      currentLoopDeps,
      (next) => {
        if (input.isCurrentSession()) input.setMessages(next)
      },
    )
    const applied = await input.handleOutcome(
      input.session,
      outcome,
      undefined,
      confirmationAbort,
    )
    await input.settleSessionOutcome(
      input.session.id,
      outcome,
      confirmationOrigin,
    )
    return applied
  } catch (error) {
    if (confirmationAbort.signal.aborted) return 'aborted'
    const blocked =
      error instanceof AgentToolEffectBlockedError ? error : null
    input.setStatus({ kind: 'error', message: errText(error) })
    await input.transitionSessionJob(
      input.session.id,
      blocked?.status ?? 'failed',
      blocked ? 'tool_failed' : 'failed',
      {
        lastError: errText(error),
        ...(blocked?.status === 'needs_attention'
          ? { pendingCallId: blocked.outcome.effect.toolCallId }
          : {}),
      },
      { phase: 'confirmed_tool' },
      confirmationOrigin,
    )
    await input.settleSessionOutcome(
      input.session.id,
      { kind: 'error' },
      confirmationOrigin,
    )
    return blocked?.status ?? 'failed'
  }
}
