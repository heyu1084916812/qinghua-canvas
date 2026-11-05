import { useCallback, type MutableRefObject } from 'react'
import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import type { PlatformKit } from '../../../../platform/ports'
import type { AgentSession } from '../../../../state/agent/sessionStore'
import type { CanvasExecutionApi } from '../../execution/CanvasExecutionProvider'
import type { AgentLoopDeps } from '../../agent/agentLoop'
import type { AgentTurnContextTrace } from './agentTurnRequest'
import type {
  AgentLoopAssemblyPorts,
  AssembleAgentLoopInput,
} from './agentLoopDeps'
import type { AgentChatRoute } from './agentChatRoute'

export interface AgentLoopDepsArgs {
  session: AgentSession
  operationId: string
  route?: AgentChatRoute
  toolMode?: 'native' | 'json'
  visualNodeIds?: readonly string[]
  onProgress?: (messages: readonly ChatMessage[]) => void
  turnTools?: readonly ToolDeclaration[]
  turnController?: AbortController
}

export type AgentLoopDepsFor = (args: AgentLoopDepsArgs) => AgentLoopDeps

/**
 * `assembleAgentLoopDeps` 的 React 装配层。
 *
 * 三条取值时机是踩过的坑，别"顺手"改成值：
 * 1. `contextTraceFor` / `turnToolsFor` / `planAliasesFor` / `deliveredSteersFor` /
 *    `abortSignalFor` / `nodeRunStates` 都是 **thunk**：回合跑到一半才写的东西
 *    （上下文素材、本轮 tools、applyPlan 别名、活动锁信号、节点运行态），
 *    在装配那一刻快照就会读到上一回合甚至空值。
 * 2. `toolCtx` **必须是同一个函数引用**：`assembleAgentLoopDeps` 会在每个工具调用时
 *    用「这一轮的 origin + session」调它，并在外面补 `visualReview` / `nodeRunStateOf`；
 *    在这里包一层新箭头就会丢掉那两处补丁，而且 origin 会变成建 hook 时的那份。
 * 3. `viewport` 是值（供 `originOf` 用），但每次组件重渲染都要跟着换 ——
 *    别把它塞进 ref 或 memo 里冻住。
 */
export interface AgentLoopDepsControllerInput {
  store: AgentLoopAssemblyPorts['store']
  channels: AgentLoopAssemblyPorts['channels']
  platform: PlatformKit
  modelRoute: AgentLoopAssemblyPorts['modelRoute']
  routeExecution: AgentLoopAssemblyPorts['routeExecution']
  sessions: AgentLoopAssemblyPorts['sessions']
  jobs: AgentLoopAssemblyPorts['jobs']
  reviewModel: string
  canvasReviewEnabled: boolean
  viewport: { x: number; y: number }
  executeToolWithLedger: AgentLoopAssemblyPorts['executeToolWithLedger']
  toolCtx: AgentLoopAssemblyPorts['toolCtx']
  execution: Pick<CanvasExecutionApi, 'nodeStates'>
  cachedChatRoute: AgentLoopAssemblyPorts['cachedChatRoute']
  commitChatRoute: AgentLoopAssemblyPorts['commitChatRoute']
  abortRefs: MutableRefObject<Map<string, AbortController>>
  contextTraceRef: MutableRefObject<
    Map<string, AgentTurnContextTrace>
  >
  planAliasesRef: MutableRefObject<Map<string, Map<string, string>>>
  turnToolsRef: MutableRefObject<
    Map<string, readonly ToolDeclaration[]>
  >
  deliveredSteersRef: MutableRefObject<Map<string, Set<string>>>
  appendLiveProcessFor: AgentLoopAssemblyPorts['appendLiveProcessFor']
  clearLiveProcessFor: NonNullable<AgentLoopAssemblyPorts['clearLiveProcessFor']>
  setLiveActivityFor: AgentLoopAssemblyPorts['setLiveActivityFor']
  setStatusFor: AgentLoopAssemblyPorts['setStatusFor']
  activeAgentTools: readonly ToolDeclaration[]
  assemble: (
    ports: AgentLoopAssemblyPorts,
    input: AssembleAgentLoopInput,
  ) => AgentLoopDeps
}

export function useAgentLoopDepsController(
  input: AgentLoopDepsControllerInput,
): AgentLoopDepsFor {
  return useCallback<AgentLoopDepsFor>(
    (args) =>
      input.assemble(
        {
          store: input.store,
          channels: input.channels,
          platform: {
            storage: input.platform.storage,
            assets: input.platform.assets,
          },
          modelRoute: input.modelRoute,
          routeExecution: input.routeExecution,
          sessions: input.sessions,
          jobs: input.jobs,
          reviewModel: input.reviewModel,
          canvasReviewEnabled: input.canvasReviewEnabled,
          viewport: input.viewport,
          executeToolWithLedger: input.executeToolWithLedger,
          toolCtx: input.toolCtx,
          nodeRunStates: () => input.execution.nodeStates,
          abortSignalFor: (sessionId) =>
            input.abortRefs.current.get(sessionId)?.signal,
          cachedChatRoute: input.cachedChatRoute,
          commitChatRoute: input.commitChatRoute,
          contextTraceFor: (sessionId) =>
            input.contextTraceRef.current.get(sessionId),
          planAliasesFor: (sessionId) =>
            input.planAliasesRef.current.get(sessionId),
          setPlanAliases: (sessionId, aliases) => {
            input.planAliasesRef.current.set(sessionId, aliases)
          },
          turnToolsFor: (sessionId) =>
            input.turnToolsRef.current.get(sessionId),
          setTurnTools: (sessionId, tools) => {
            input.turnToolsRef.current.set(sessionId, tools)
          },
          deliveredSteersFor: (sessionId) =>
            input.deliveredSteersRef.current.get(sessionId) ??
            new Set<string>(),
          setDeliveredSteers: (sessionId, ids) => {
            input.deliveredSteersRef.current.set(sessionId, ids)
          },
          appendLiveProcessFor: input.appendLiveProcessFor,
          clearLiveProcessFor: input.clearLiveProcessFor,
          setLiveActivityFor: input.setLiveActivityFor,
          setStatusFor: input.setStatusFor,
        },
        {
          session: args.session,
          operationId: args.operationId,
          ...(args.route ? { route: args.route } : {}),
          toolMode: args.toolMode ?? 'native',
          visualNodeIds: args.visualNodeIds ?? [],
          onProgress: args.onProgress,
          turnTools: args.turnTools ?? input.activeAgentTools,
          turnController: args.turnController,
          abortSignalFor: (sessionId) =>
            input.abortRefs.current.get(sessionId)?.signal,
        },
      ),
    [
      input.abortRefs,
      input.activeAgentTools,
      input.appendLiveProcessFor,
      input.assemble,
      input.cachedChatRoute,
      input.canvasReviewEnabled,
      input.channels,
      input.clearLiveProcessFor,
      input.commitChatRoute,
      input.contextTraceRef,
      input.deliveredSteersRef,
      input.executeToolWithLedger,
      input.execution,
      input.jobs,
      input.modelRoute,
      input.planAliasesRef,
      input.platform,
      input.reviewModel,
      input.routeExecution,
      input.sessions,
      input.setLiveActivityFor,
      input.setStatusFor,
      input.store,
      input.toolCtx,
      input.turnToolsRef,
      input.viewport,
    ],
  )
}
