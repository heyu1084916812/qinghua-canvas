import { useCallback, type MutableRefObject } from 'react'
import type { ToolDeclaration } from '../../../../domain/shared/execution/types'
import type { AgentToolMode } from '../../../../features/shared/agent/toolSupport'
import type { TaskLifecycle } from '../../../../features/shared/lifecycle/taskLifecycle'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import { createId } from '../../../../shared/id'
import type { AgentLoopOutcome } from '../../agent/agentLoop'
import type {
  AgentPrepareArgs,
  AgentSendTurnPorts,
  AgentSendTurnUi,
} from './agentSendTurnRun'
import { runAgentSendTurn } from './agentSendTurnRun'
import type {
  AgentTurnContextTrace,
  AgentTurnRequestPreparation,
} from './agentTurnRequest'
import type { ExplicitMediaModels } from './mediaMentions'

export type AgentRunSendText = (
  text: string,
  session: AgentSession,
  turnId?: string,
  internalControl?: boolean,
  actualTurnId?: string,
  turnAbort?: AbortController,
) => Promise<AgentLoopOutcome | undefined>

/**
 * 发送主体的 React 装配层。
 *
 * 顺序、活动锁 CAS、routeReady 与收口都在 `agentSendTurnRun.ts`；这里只把
 * per-session refs、UI 回调与已经拆好的纯函数接成端口。端口全部按"调用时取值"
 * 的方式传入（refs 与模块函数直接传引用），所以返回的回调在渲染之间保持同一身份。
 *
 * `prepareTurn` 由宿主提供：`prepareAgentTurnRequest` 的静态入参（graph /
 * selection / memory / skills / channels …）本身就是宿主的数据接线，搬进本
 * hook 只会让这些依赖再抄一遍；这里只负责把两个顺序回调转交给主体。
 */
export interface AgentSendTurnControllerInput {
  currentTurnJobIdRef: MutableRefObject<Map<string, string>>
  currentTurnIdRef: MutableRefObject<Map<string, string>>
  currentTurnRevisionRef: MutableRefObject<Map<string, number>>
  abortRefs: MutableRefObject<Map<string, AbortController>>
  contextTraceRef: MutableRefObject<Map<string, AgentTurnContextTrace>>
  toolModeRef: MutableRefObject<Map<string, AgentToolMode>>
  explicitMediaModelsRef: MutableRefObject<
    Map<string, ExplicitMediaModels>
  >
  turnToolsRef: MutableRefObject<
    Map<string, readonly ToolDeclaration[]>
  >
  currentIdRef: MutableRefObject<string | null>
  sessionRuntime: {
    readonly current: {
      setPerImage(sessionId: string, value: boolean): void
    }
  }
  setList: AgentSendTurnUi['setList']
  setCurrent: AgentSendTurnUi['setCurrent']
  setDraft: AgentSendTurnUi['setDraft']
  writeDraftForSession: AgentSendTurnUi['writeDraftForSession']
  setMessages: AgentSendTurnUi['setMessages']
  setStatusFor: AgentSendTurnUi['setStatusFor']
  clearLiveActivitiesFor: AgentSendTurnUi['clearLiveActivities']
  clearLiveProcessFor: AgentSendTurnUi['clearLiveProcess']
  clearRunTasksFor: AgentSendTurnUi['clearRunTasks']
  clearReveal: AgentSendTurnUi['clearReveal']
  trackRun: TaskLifecycle['track']
  updateSessionFields: AgentSendTurnPorts['updateSessionFields']
  savePhaseEventMessages: AgentSendTurnPorts['savePhaseEventMessages']
  failTurn: AgentSendTurnPorts['failTurn']
  ensureJob: AgentSendTurnPorts['ensureJob']
  transitionSessionJob: AgentSendTurnPorts['transition']
  loopDeps: AgentSendTurnPorts['loopDeps']
  runAgentTurn: AgentSendTurnPorts['runTurn']
  continueAutoConfirmations: AgentSendTurnPorts['continueAutoConfirmations']
  handleOutcome: AgentSendTurnPorts['handleOutcome']
  bindTurnToSessionActivity: AgentSendTurnPorts['bindTurnToSessionActivity']
  syncAutoRunFromSession: AgentSendTurnPorts['syncAutoRunFromSession']
  prepareTurn: (
    args: AgentPrepareArgs,
  ) => Promise<AgentTurnRequestPreparation>
}

export function useAgentSendTurnController(
  input: AgentSendTurnControllerInput,
): AgentRunSendText {
  const runSendText = useCallback<AgentRunSendText>(
    (
      text,
      session,
      turnId,
      internalControl = false,
      actualTurnId = createId('turnmsg'),
      turnAbort = new AbortController(),
    ) =>
      runAgentSendTurn(
        {
          text,
          session,
          queueTurnId: turnId,
          internalControl,
          actualTurnId,
          turnAbort,
        },
        {
          trackRun: input.trackRun,
          updateSessionFields: input.updateSessionFields,
          savePhaseEventMessages: input.savePhaseEventMessages,
          failTurn: input.failTurn,
          prepare: input.prepareTurn,
          ensureJob: input.ensureJob,
          transition: input.transitionSessionJob,
          loopDeps: input.loopDeps,
          runTurn: input.runAgentTurn,
          continueAutoConfirmations: input.continueAutoConfirmations,
          handleOutcome: input.handleOutcome,
          bindTurnToSessionActivity: input.bindTurnToSessionActivity,
          syncAutoRunFromSession: input.syncAutoRunFromSession,
          refs: {
            currentTurnJobId: input.currentTurnJobIdRef,
            currentTurnId: input.currentTurnIdRef,
            currentTurnRevision: input.currentTurnRevisionRef,
            abort: input.abortRefs,
            contextTrace: input.contextTraceRef,
            toolMode: input.toolModeRef,
            explicitMediaModels: input.explicitMediaModelsRef,
            turnTools: input.turnToolsRef,
          },
          ui: {
            currentIdRef: input.currentIdRef,
            setList: input.setList,
            setCurrent: input.setCurrent,
            setDraft: input.setDraft,
            writeDraftForSession: input.writeDraftForSession,
            setMessages: input.setMessages,
            setStatusFor: input.setStatusFor,
            clearLiveActivities: input.clearLiveActivitiesFor,
            clearLiveProcess: input.clearLiveProcessFor,
            clearRunTasks: input.clearRunTasksFor,
            clearReveal: input.clearReveal,
            setPerImage: (sessionId, value) =>
              input.sessionRuntime.current.setPerImage(
                sessionId,
                value,
              ),
          },
        },
      ),
    [
      input.abortRefs,
      input.bindTurnToSessionActivity,
      input.clearLiveActivitiesFor,
      input.clearLiveProcessFor,
      input.clearReveal,
      input.clearRunTasksFor,
      input.continueAutoConfirmations,
      input.contextTraceRef,
      input.currentIdRef,
      input.currentTurnIdRef,
      input.currentTurnJobIdRef,
      input.currentTurnRevisionRef,
      input.ensureJob,
      input.explicitMediaModelsRef,
      input.failTurn,
      input.handleOutcome,
      input.loopDeps,
      input.prepareTurn,
      input.runAgentTurn,
      input.savePhaseEventMessages,
      input.sessionRuntime,
      input.setCurrent,
      input.setDraft,
      input.setList,
      input.setMessages,
      input.setStatusFor,
      input.syncAutoRunFromSession,
      input.toolModeRef,
      input.trackRun,
      input.transitionSessionJob,
      input.turnToolsRef,
      input.updateSessionFields,
      input.writeDraftForSession,
    ],
  )
  return runSendText
}
