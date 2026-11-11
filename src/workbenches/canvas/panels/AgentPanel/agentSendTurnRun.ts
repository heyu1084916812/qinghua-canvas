import type { MutableRefObject } from 'react'
import type { ChatMessage, ToolDeclaration } from '../../../../domain/shared/execution/types'
import type { AgentController } from '../../../../features/shared/agent/AgentController'
import type { AgentToolMode } from '../../../../features/shared/agent/toolSupport'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { errText, type AgentLoopDeps, type AgentLoopOutcome } from '../../agent/agentLoop'
import type { AgentPanelStatus } from './AgentActivityViews'
import {
  buildAgentModelMessages,
  composeAgentOutcomeMessages,
  type PersistedAgentUserTurn,
} from './agentTurnPersistence'
import type {
  AgentTurnContextTrace,
  AgentTurnRequestPreparation,
  PreparedAgentTurnRequest,
} from './agentTurnRequest'
import { failureStatus, failureTurnPayload, sendTurnSeed } from './agentSendTurnPlan'
import type { ExplicitMediaModels } from './mediaMentions'
import type { AgentRequestMode } from '../../agent/agentContextPolicy'

/**
 * 一次发送回合的主体（A2 刀，从 AgentPanel.runSendText 搬出）。
 *
 * 这里只有**顺序与所有权**：准备请求 → 写 per-session ref → 跑循环 → 自动续跑
 * → 结果收口。真正的行为都在端口背后（`prepareAgentTurnRequest` / `agentLoop` /
 * `agentOutcomeCoordinator`），本文件不复制它们的规则。
 *
 * 验收基线是 `agentSendTurnPlan.ts` 顶部那 10 条顺序清单，逐条由
 * `agentSendTurnRun.test.ts` 断言，别在改这里时"顺手优化"顺序。
 */

export interface AgentSendTurnInput {
  text: string
  session: AgentSession
  /** 队列回合的 id；直接发送时为 undefined。 */
  queueTurnId?: string
  internalControl: boolean
  actualTurnId: string
  turnAbort: AbortController
}

/** 本回合要写的 per-session ref（顺序见 A-5 #1 / #4 / #9）。 */
export interface AgentSendTurnRefs {
  currentTurnJobId: MutableRefObject<Map<string, string>>
  currentTurnId: MutableRefObject<Map<string, string>>
  currentTurnRevision: MutableRefObject<Map<string, number>>
  abort: MutableRefObject<Map<string, AbortController>>
  contextTrace: MutableRefObject<Map<string, AgentTurnContextTrace>>
  toolMode: MutableRefObject<Map<string, AgentToolMode>>
  explicitMediaModels: MutableRefObject<Map<string, ExplicitMediaModels>>
  turnTools: MutableRefObject<Map<string, readonly ToolDeclaration[]>>
}

export interface AgentSendTurnUi {
  currentIdRef: MutableRefObject<string | null>
  setList: (
    update: (previous: AgentSession[]) => AgentSession[],
  ) => void
  setCurrent: (session: AgentSession) => void
  setDraft: (value: string) => void
  writeDraftForSession: (sessionId: string, text: string) => void
  setMessages: (messages: ChatMessage[]) => void
  setStatusFor: (sessionId: string, status: AgentPanelStatus) => void
  clearLiveActivities: (sessionId: string) => void
  clearLiveProcess: (sessionId: string) => void
  clearRunTasks: (sessionId: string) => void
  clearReveal: () => void
  setPerImage: (sessionId: string, value: boolean) => void
}

export interface AgentPrepareHooks {
  onPersisted: (turn: PersistedAgentUserTurn) => void
  onRouteReady: (operationId: string) => Promise<void>
}

export interface AgentPrepareArgs {
  session: AgentSession
  text: string
  internalControl: boolean
  signal: AbortSignal
  hooks: AgentPrepareHooks
}

export interface AgentLoopDepsArgs {
  session: AgentSession
  operationId: string
  toolMode?: AgentToolMode
  requestMode?: AgentRequestMode
  taskKey?: string
  visualNodeIds?: readonly string[]
  onProgress?: (messages: readonly ChatMessage[]) => void
  turnTools?: readonly ToolDeclaration[]
  turnController?: AbortController
}

export interface AgentSendTurnPorts {
  trackRun: TaskLifecycle['track']
  savePhaseEventMessages: (
    sessionId: string,
    messages: readonly ChatMessage[],
  ) => Promise<AgentSession | null>
  updateSessionFields: (
    sessionId: string,
    patch: { taskPlan: undefined },
  ) => Promise<AgentSession | null>
  failTurn: AgentController['failTurn']
  /** 宿主侧把 prepareAgentTurnRequest 的静态入参接好，只把两个回调交回来。 */
  prepare: (args: AgentPrepareArgs) => Promise<AgentTurnRequestPreparation>
  ensureJob: (
    session: AgentSession,
    turnId: string,
  ) => Promise<{ id: string }>
  transition: AgentController['transition']
  loopDeps: (args: AgentLoopDepsArgs) => AgentLoopDeps
  runTurn: (
    messages: readonly ChatMessage[],
    deps: AgentLoopDeps,
  ) => Promise<AgentLoopOutcome>
  continueAutoConfirmations: (
    session: AgentSession,
    initial: AgentLoopOutcome,
    deps: AgentLoopDeps,
    onMessages: (messages: ChatMessage[]) => void,
  ) => Promise<AgentLoopOutcome>
  handleOutcome: (
    session: AgentSession,
    outcome: AgentLoopOutcome,
    persistedTurn: PersistedAgentUserTurn,
    controller: AbortController,
  ) => Promise<unknown>
  bindTurnToSessionActivity: (sessionId: string, turnId: string) => boolean
  syncAutoRunFromSession: (session: AgentSession) => void
  refs: AgentSendTurnRefs
  ui: AgentSendTurnUi
}

export async function runAgentSendTurn(
  input: AgentSendTurnInput,
  ports: AgentSendTurnPorts,
): Promise<AgentLoopOutcome | undefined> {
  const { session, text, queueTurnId, internalControl, actualTurnId } =
    input
  const { turnAbort } = input
  const { refs, ui } = ports
  const { turnOrigin, clearTaskPlan } = sendTurnSeed({
    session,
    text,
    actualTurnId,
    queueTurnId,
  })
  // A-5 #1：必须在 prepare 之前、且同步完成（中间不能插 await）。
  refs.currentTurnJobId.current.delete(session.id)
  if (clearTaskPlan) {
    const cleared = await ports.trackRun(() =>
      ports.updateSessionFields(session.id, {
        taskPlan: undefined,
      }),
    )
    if (cleared) {
      ui.setList((prev) =>
        prev.map((item) => (item.id === cleared.id ? cleared : item)),
      )
      if (ui.currentIdRef.current === cleared.id) ui.setCurrent(cleared)
    }
  }

  let routeReady = false
  // A-5 #7：failTurn → 三个 clear → setStatus，顺序不可调换。
  const failBeforeModel = async (message: string, phase: string) => {
    await ports.failTurn(
      session.id,
      failureTurnPayload({
        message,
        phase,
        aborted: turnAbort.signal.aborted,
        origin: turnOrigin,
      }),
    )
    ui.clearLiveActivities(session.id)
    ui.clearLiveProcess(session.id)
    ui.clearRunTasks(session.id)
    ui.setStatusFor(
      session.id,
      failureStatus(turnAbort.signal.aborted, message),
    )
  }

  let requestPreparation: AgentTurnRequestPreparation
  try {
    requestPreparation = await ports.prepare({
      session,
      text,
      internalControl,
      signal: turnAbort.signal,
      hooks: {
        // A-5 #3 / #9：落库 + 抢锁 + ref + abort → thinking，全在 onPersisted 内。
        onPersisted: (turn) => {
          const saved = turn.saved
          // 活动锁 CAS：必须在这里同步抛，交给 prepare 回滚本回合。
          if (!ports.bindTurnToSessionActivity(saved.id, actualTurnId)) {
            throw new Error('会话活动锁已被其他回合占用')
          }
          turnOrigin.messageRevision = turn.messageRevision
          refs.currentTurnId.current.set(session.id, actualTurnId)
          refs.currentTurnRevision.current.set(
            session.id,
            turn.messageRevision,
          )
          ui.setList((prev) =>
            prev.map((item) => (item.id === saved.id ? saved : item)),
          )
          if (ui.currentIdRef.current === saved.id) {
            ui.setCurrent(saved)
            ui.setDraft('')
            ui.writeDraftForSession(session.id, '')
            ui.setMessages(turn.historyMessages)
          }
          ui.clearLiveActivities(session.id)
          ui.clearLiveProcess(session.id)
          ui.clearRunTasks(session.id)
          refs.abort.current.set(session.id, turnAbort)
          ui.setStatusFor(session.id, { kind: 'thinking' })
          ports.syncAutoRunFromSession(session)
        },
        // A-5 #8：routeReady 必须在 ensureJob 之前置位。
        onRouteReady: async (operationId) => {
          routeReady = true
          const job = await ports.ensureJob(session, actualTurnId)
          refs.currentTurnJobId.current.set(session.id, job.id)
          turnOrigin.jobId = job.id
          await ports.transition(
            session.id,
            'planning',
            'status_changed',
            { operationId },
            undefined,
            turnOrigin,
          )
        },
      },
    })
  } catch (error) {
    // 只有"Job 已建之后"的错误才允许冒泡；之前的错误转成 error 状态收口。
    if (routeReady) throw error
    if (turnAbort.signal.aborted) return
    ui.setStatusFor(session.id, {
      kind: 'error',
      message: `用户消息或路由准备失败：${errText(error)}`,
    })
    return
  }
  if (requestPreparation.kind === 'aborted_before_job') return
  if (requestPreparation.kind === 'route_failed') {
    ui.setStatusFor(session.id, {
      kind: 'error',
      message: requestPreparation.message,
    })
    return
  }
  if (requestPreparation.kind === 'failed') {
    if (requestPreparation.contextTrace) {
      refs.contextTrace.current.set(
        session.id,
        requestPreparation.contextTrace,
      )
    } else {
      refs.contextTrace.current.delete(session.id)
    }
    await failBeforeModel(
      requestPreparation.message,
      requestPreparation.phase,
    )
    return
  }

  const prepared = requestPreparation
  const persistedUserTurn = prepared.persistedTurn
  const operationId = prepared.operationId
  const toolMode = prepared.toolMode
  const turnAgentTools = prepared.turnTools
  // A-5 #4：这五个 ref 必须在 loopDeps(...) 之前写好（loopDeps 按 ref 现取）。
  if (prepared.contextTrace) {
    refs.contextTrace.current.set(session.id, prepared.contextTrace)
  } else {
    refs.contextTrace.current.delete(session.id)
  }
  refs.toolMode.current.set(session.id, toolMode)
  refs.explicitMediaModels.current.set(
    session.id,
    prepared.explicitMediaModels,
  )
  ui.setPerImage(session.id, prepared.perImage)
  refs.turnTools.current.set(session.id, turnAgentTools)
  // 任务判定已写库；回灌到面板快照，让确认 / 续跑入口读到同一个任务。
  const agentTask = prepared.agentTask
  if (agentTask) {
    ui.setList((prev) =>
      prev.map((item) => (item.id === session.id ? { ...item, agentTask } : item)),
    )
  }
  if (prepared.clearedPendingAssets) {
    const cleared = agentTask
      ? { ...prepared.clearedPendingAssets, agentTask }
      : prepared.clearedPendingAssets
    ui.setList((prev) =>
      prev.map((item) => (item.id === cleared.id ? cleared : item)),
    )
    if (ui.currentIdRef.current === cleared.id) ui.setCurrent(cleared)
  }
  const withFullHistory = (list: readonly ChatMessage[]): ChatMessage[] =>
    composeAgentOutcomeMessages(persistedUserTurn, list)
  const withSystem = buildAgentModelMessages(
    prepared.systemPrompt,
    persistedUserTurn,
  )
  // A-5 #5：loopDeps 必须在 runAgentTurn 之前。
  const currentLoopDeps = ports.loopDeps({
    session,
    operationId,
    toolMode,
    requestMode: prepared.requestMode,
    taskKey: prepared.taskKey,
    visualNodeIds: prepared.visualNodeIds,
    onProgress: (next) => {
      if (ui.currentIdRef.current !== session.id) return
      ui.clearReveal()
      ui.setMessages(withFullHistory(next))
    },
    turnTools: turnAgentTools,
    turnController: turnAbort,
  })
  // A-5 #6：run → continue → handleOutcome 固定。
  const initial = await ports.runTurn(withSystem, currentLoopDeps)
  const outcome = await ports.continueAutoConfirmations(
    session,
    initial,
    currentLoopDeps,
    (next) => {
      if (ui.currentIdRef.current === session.id) {
        ui.setMessages(withFullHistory(next))
      }
    },
  )
  const phaseEvents = [
    ...(prepared.contextTrace?.skillPhaseEvent
      ? [prepared.contextTrace.skillPhaseEvent]
      : []),
    ...(prepared.contextTrace?.referencePhaseEvent
      ? [prepared.contextTrace.referencePhaseEvent]
      : []),
  ]
  const savedPhaseEventMessages = phaseEvents.length > 0
    ? await savePhaseEvents({
        sessionId: session.id,
        events: phaseEvents,
        history: withFullHistory(outcome.messages),
        saveMessages: ports.savePhaseEventMessages,
      })
    : null
  // A-5 #10：必须在 handleOutcome 之后才把 outcome 交回调用方。
  await ports.handleOutcome(
    session,
    outcome,
    savedPhaseEventMessages
      ? { ...persistedUserTurn, historyMessages: savedPhaseEventMessages }
      : persistedUserTurn,
    turnAbort,
  )
  if (savedPhaseEventMessages && ui.currentIdRef.current === session.id) {
    ui.setMessages(savedPhaseEventMessages)
  }
  return outcome
}

async function savePhaseEvents(input: {
  sessionId: string
  events: NonNullable<
    NonNullable<PreparedAgentTurnRequest['contextTrace']>['referencePhaseEvent']
  >[]
  history: ChatMessage[]
  saveMessages: AgentSendTurnPorts['savePhaseEventMessages']
}): Promise<ChatMessage[] | null> {
  const userIndex = input.history.reduce(
    (at, message, index) => message.role === 'user' ? index : at,
    -1,
  )
  if (userIndex < 0) return null
  const startedAt = Date.now()
  const eventMessages: ChatMessage[] = input.events.map((event, index) => ({
    role: 'assistant',
    content: '',
    createdAt: startedAt + index,
    phaseEvent: {
      phase: event.phase,
      title: event.title,
      ...(event.detail ? { detail: event.detail } : {}),
      ...(event.evidence ? { evidence: [...event.evidence] } : {}),
    },
  }))
  const history = [...input.history]
  history.splice(userIndex + 1, 0, ...eventMessages)
  const saved = await input.saveMessages(input.sessionId, history)
  return saved?.messages ?? history
}
