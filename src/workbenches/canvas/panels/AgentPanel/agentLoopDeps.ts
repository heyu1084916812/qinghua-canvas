import type {
  ChatMessage,
  ToolDeclaration,
} from '../../../../domain/shared/execution/types'
import { toLogicalName } from '../../../../domain/project/modelCatalog'
import { normalizeTaskPlanProposal } from '../../../../domain/agent/taskPlan'
import { steerMessagesOf } from '../../../../domain/agent/steering'
import type { TextRunRequest } from '../../../../platform/channels/types'
import type { PlatformKit } from '../../../../platform/ports'
import type {
  AgentSession,
  AgentSessionStore,
} from '../../../../state/agent/sessionStore'
import type { AgentJobStore } from '../../../../state/agent/jobStore'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import type { ModelRoutePort } from '../../../../features/shared/agent/ModelRoutePort'
import type { RouteExecutionPort } from '../../../../features/shared/agent/RouteExecutionPort'
import {
  type AgentLoopActivity,
  type AgentLoopDeps,
} from '../../agent/agentLoop'
import {
  agentToolsForCapabilities,
  discoverAgentTools,
  executeConfirmedTool,
  executeReadTool,
  runFromNodeIds,
  type AgentToolContext,
} from '../../agent/tools'
import { runPreflightProblems } from '../../agent/runPreflight'
import { stripMentionMarkup } from '../../text/MentionEditor'
import { originOf } from './agentPanelViewHelpers'
import { collectAgentLoopInputs } from './agentLoopInputs'
import {
  agentLoopTrace,
  promoteAgentChatRouteCandidate,
} from './agentLoopTrace'
import type { AgentChatRoute } from './agentChatRoute'
import type { AgentTurnContextTrace } from './agentTurnRequest'
import {
  runAgentVisualReview,
  type AgentVisualReviewDeps,
} from './agentVisualReview'
import { latestRunFailuresForNodes } from './agentRunState'

export interface AgentLoopAssemblyPorts {
  store: AgentToolContext['store']
  channels: Pick<ChannelStore, 'getState' | 'protocolCatalog'>
  platform: Pick<PlatformKit, 'storage' | 'assets'>
  modelRoute: ModelRoutePort
  routeExecution: RouteExecutionPort
  sessions: Pick<AgentSessionStore, 'get'>
  jobs: Pick<AgentJobStore, 'active' | 'appendEvent'>
  reviewModel: string
  canvasReviewEnabled: boolean
  viewport: { x: number; y: number }
  /** 未显式传 controller 时回落到所属会话的同一信号（确认 / 继续入口）。 */
  abortSignalFor: (sessionId: string) => AbortSignal | undefined
  executeToolWithLedger: (
    sessionId: string,
    request: { callId: string; name: string; args: unknown },
    execute: () => Promise<unknown>,
  ) => Promise<unknown>
  toolCtx: (
    origin: { x: number; y: number },
    session: AgentSession,
  ) => AgentToolContext
  /**
   * 每次读取当前项目运行态，不能捕获某次 render 的 Map 快照。
   * 失败态携带 AppError，不是字符串。
   */
  nodeRunStates: () => ReadonlyMap<string, RunTaskState>
  cachedChatRoute: (
    session: AgentSession,
  ) => AgentChatRoute | null
  commitChatRoute: (
    sessionId: string,
    expectedRoute: AgentChatRoute,
    nextRoute: AgentChatRoute,
  ) => boolean
  contextTraceFor: (
    sessionId: string,
  ) => AgentTurnContextTrace | undefined
  planAliasesFor: (
    sessionId: string,
  ) => ReadonlyMap<string, string> | undefined
  setPlanAliases: (
    sessionId: string,
    aliases: Map<string, string>,
  ) => void
  turnToolsFor: (
    sessionId: string,
  ) => readonly ToolDeclaration[] | undefined
  setTurnTools: (
    sessionId: string,
    tools: readonly ToolDeclaration[],
  ) => void
  deliveredSteersFor: (sessionId: string) => Set<string>
  setDeliveredSteers: (
    sessionId: string,
    ids: Set<string>,
  ) => void
  appendLiveProcessFor: (sessionId: string, text: string) => void
  setLiveActivityFor: (
    sessionId: string,
    activity: AgentLoopActivity,
  ) => void
  setStatusFor: (
    sessionId: string,
    status:
      | { kind: 'thinking' }
      | { kind: 'toolRunning' },
  ) => void
}

export interface AssembleAgentLoopInput {
  session: AgentSession
  operationId: string
  /** 调用方刚刚确保过的路由；优先于可能已被清空的缓存。 */
  route?: AgentChatRoute
  toolMode?: 'native' | 'json'
  visualNodeIds?: readonly string[]
  onProgress?: (messages: readonly ChatMessage[]) => void
  turnTools: readonly ToolDeclaration[]
  /** 本回合创建时绑定的 controller；不能在装配或回调时改从别处取。 */
  turnController?: AbortController
  /** 确认 / 继续入口在未显式传 controller 时仍从所属会话取同一信号。 */
  abortSignalFor: (sessionId: string) => AbortSignal | undefined
}

/**
 * 将画布、路由、会话和工具执行端口组装成 AgentLoopDeps。
 * 不拥有 React state，也不实现第二套工具、持久化或模型循环。
 */
export function assembleAgentLoopDeps(
  ports: AgentLoopAssemblyPorts,
  input: AssembleAgentLoopInput,
): AgentLoopDeps {
  const {
    session,
    operationId,
    toolMode = 'native',
    visualNodeIds = [],
    onProgress,
    turnTools,
  } = input
  const route = input.route ?? ports.cachedChatRoute(session)
  const logicalModel =
    route?.logicalModel ??
    (toLogicalName(ports.channels.getState().channels, session.model) ||
      session.model)
  const inputs = collectAgentLoopInputs(
    ports.store.getSnapshot().nodes,
    visualNodeIds,
    ports.contextTraceFor(session.id)?.assetRefs ?? [],
  )
  const traceOf = (request: TextRunRequest) =>
    agentLoopTrace({
      projectId: ports.store.getSnapshot().projectId,
      sessionId: session.id,
      operationId,
      request,
      purpose: 'agent',
      toolMode,
      context: ports.contextTraceFor(session.id),
    })
  const onRecordWarning = (warning: string) =>
    ports.store.notify(
      `结果已返回，但运行记录写入失败：${warning}`,
      'error',
    )
  const onRouteSucceeded =
    (baseRoute: AgentChatRoute) =>
    (
      selected: Parameters<RouteExecutionPort['execute']>[0] extends {
        onRouteSucceeded?: (route: infer T) => void
      }
        ? T
        : never,
    ) => {
      ports.commitChatRoute(
        session.id,
        baseRoute,
        promoteAgentChatRouteCandidate(baseRoute, selected),
      )
    }
  const signalOf = () =>
    input.turnController?.signal ??
    ports.abortSignalFor(session.id) ??
    new AbortController().signal
  const runVisualReview = (review: {
    nodeIds: readonly string[]
    checklist?: string
  }) => {
    const visualReviewDeps: AgentVisualReviewDeps = {
      store: ports.store,
      allChannels: ports.channels.getState().channels,
      modelRoute: ports.modelRoute,
      routeExecution: ports.routeExecution,
      platform: ports.platform,
      onRecordWarning,
    }
    return runAgentVisualReview(visualReviewDeps, {
      sessionId: session.id,
      operationId,
      route: ports.cachedChatRoute(session) ?? route,
      reviewModel: ports.reviewModel,
      ...(ports.planAliasesFor(session.id)
        ? { aliases: ports.planAliasesFor(session.id)! }
        : {}),
      ...(ports.contextTraceFor(session.id)
        ? { contextTrace: ports.contextTraceFor(session.id)! }
        : {}),
      signal: signalOf(),
      review,
    })
  }
  const executeText = (
    request: TextRunRequest,
    signal: AbortSignal,
    onStream?: Parameters<RouteExecutionPort['execute']>[0]['onStream'],
  ) => {
    const liveRoute = ports.cachedChatRoute(session) ?? route
    return ports.routeExecution.execute({
      channelId: liveRoute?.channelId ?? request.channelId,
      model: liveRoute?.upstreamModel ?? request.model,
      modelIsUpstream: Boolean(liveRoute),
      tools:
        request.tools ??
        (toolMode === 'native' ? turnTools : []),
      messages: request.messages ?? [],
      inputs: request.inputs,
      signal,
      ...(liveRoute
        ? {
            routeCandidates: liveRoute.candidates,
            routePlanId: liveRoute.routePlanId,
          }
        : {}),
      trace: traceOf(request),
      onRecordWarning,
      ...(liveRoute
        ? { onRouteSucceeded: onRouteSucceeded(liveRoute) }
        : {}),
      ...(onStream ? { onStream } : {}),
    })
  }
  return {
    adapter: {
      completeText: (request, signal) =>
        executeText(request, signal),
    },
    streamModel: (request, signal, onProcess) =>
      executeText(request, signal, (chunk) => {
        if (chunk.reasoning) {
          onProcess({ kind: 'reasoning', text: chunk.reasoning })
        }
        if (chunk.text) {
          onProcess({ kind: 'content', text: chunk.text })
        }
        for (const delta of chunk.toolCallDeltas ?? []) {
          if (delta.name) {
            onProcess({
              kind: 'tool',
              text: `准备调用 ${delta.name}`,
            })
          }
        }
      }),
    onProcess: (kind, text) => {
      ports.appendLiveProcessFor(session.id, text)
      if (kind === 'reasoning' || kind === 'content') {
        ports.setStatusFor(session.id, { kind: 'thinking' })
      }
    },
    channelId: route?.channelId ?? '',
    model: logicalModel,
    tools: turnTools,
    discoverCapabilities: async (args: unknown) => {
      const query =
        args && typeof args === 'object' && !Array.isArray(args)
          ? String((args as { query?: unknown }).query ?? '')
          : ''
      const discovered = discoverAgentTools(
        query,
        agentToolsForCapabilities({
          canvasReview: ports.canvasReviewEnabled,
        }),
      )
      const loaded = [
        ...(ports.turnToolsFor(session.id) ?? turnTools),
      ]
      const names = new Set(loaded.map((tool) => tool.name))
      for (const tool of discovered.tools) {
        if (names.has(tool.name)) continue
        names.add(tool.name)
        loaded.push(tool)
      }
      ports.setTurnTools(session.id, loaded)
      return discovered
    },
    toolMode,
    inputs,
    precheck: (name: string, args: unknown) => {
      if (name === 'proposeTaskPlan') {
        const normalized = normalizeTaskPlanProposal(args, {
          id: 'precheck-plan',
          now: Date.now(),
        })
        return normalized.ok
          ? { ok: true as const }
          : {
              ok: false as const,
              result: { ok: false, problems: normalized.problems },
            }
      }
      if (name !== 'runNode' && name !== 'runFrom') {
        return { ok: true as const }
      }
      const args2 = (args ?? {}) as { nodeIds?: unknown }
      const aliases = ports.planAliasesFor(session.id)
      const requested = (
        Array.isArray(args2.nodeIds)
          ? args2.nodeIds.map(String)
          : []
      ).map((id) => aliases?.get(id) ?? id)
      const graph = ports.store.getSnapshot()
      let targets = requested
      if (name === 'runFrom') {
        const resolved = runFromNodeIds(ports.store, requested)
        if (!resolved.ok) {
          return { ok: false as const, result: resolved }
        }
        targets = resolved.ids
      }
      const problems = runPreflightProblems(
        targets,
        graph,
        ports.channels.getState().channels,
        ports.channels.protocolCatalog(),
      )
      return problems.length > 0
        ? { ok: false as const, result: { ok: false, problems } }
        : { ok: true as const }
    },
    executeWrite: async (name: string, args: unknown, callId: string) => {
      const result = await ports.executeToolWithLedger(
        session.id,
        { callId, name, args },
        () =>
          executeConfirmedTool(
            name,
            args,
            ports.toolCtx(originOf(ports.viewport), session),
          ),
      )
      if (name === 'applyPlan') {
        const resolved = (
          result as {
            resolvedNodes?: {
              localId?: unknown
              nodeId?: unknown
            }[]
          }
        ).resolvedNodes
        if (Array.isArray(resolved)) {
          ports.setPlanAliases(
            session.id,
            new Map(
              resolved.flatMap((node) =>
                typeof node.localId === 'string' &&
                typeof node.nodeId === 'string'
                  ? [[node.localId, node.nodeId] as const]
                  : [],
              ),
            ),
          )
        }
      }
      return result
    },
    executeRead: async (name: string, args: unknown, callId: string) => {
      const base = ports.toolCtx(originOf(ports.viewport), session)
      const requestedNodeIds =
        name === 'readResult' &&
        args &&
        typeof args === 'object' &&
        !Array.isArray(args) &&
        Array.isArray((args as { nodeIds?: unknown }).nodeIds)
          ? (args as { nodeIds: unknown[] }).nodeIds.filter(
              (nodeId): nodeId is string =>
                typeof nodeId === 'string',
            )
          : []
      const persistedFailures =
        name === 'readResult'
          ? await latestRunFailuresForNodes(
              ports.platform.storage,
              ports.store.getSnapshot().projectId,
              requestedNodeIds,
            ).catch(() => new Map())
          : new Map()
      return ports.executeToolWithLedger(
        session.id,
        { callId, name, args },
        () =>
          executeReadTool(name, args, {
            ...base,
            ...(name === 'visualReview' && ports.canvasReviewEnabled
              ? { visualReview: runVisualReview }
              : {}),
            ...(name === 'readResult'
              ? {
                  nodeRunStateOf: (nodeId: string) => {
                    const persisted = persistedFailures.get(nodeId)
                    if (persisted) return persisted
                    const state = ports.nodeRunStates().get(nodeId)
                    return state?.kind === 'failed'
                      ? {
                          kind: 'failed' as const,
                          error: state.error,
                        }
                      : undefined
                  },
                }
              : {}),
          }),
      )
    },
    onActivity: (activity) => {
      ports.setLiveActivityFor(session.id, activity)
      if (activity.phase === 'thinking') {
        ports.setStatusFor(session.id, { kind: 'thinking' })
      } else if (activity.status === 'running') {
        ports.setStatusFor(session.id, { kind: 'toolRunning' })
      }
    },
    ...(onProgress ? { onProgress } : {}),
    takeSteering: async () => {
      try {
        const latest = await ports.sessions.get(session.id)
        const delivered = ports.deliveredSteersFor(session.id)
        const pending = (latest?.pendingSteers ?? []).filter(
          (steer) => !delivered.has(steer.id),
        )
        if (pending.length === 0) return []
        const active = await ports.jobs
          .active(session.id)
          .catch(() => null)
        if (active) {
          await Promise.all(
            pending.map((steer) =>
              ports.jobs
                .appendEvent(active.id, 'steer_applied', {
                  steerId: steer.id,
                  textLength: steer.text.length,
                })
                .catch(() => null),
            ),
          )
        }
        for (const steer of pending) delivered.add(steer.id)
        ports.setDeliveredSteers(session.id, delivered)
        return steerMessagesOf(pending, stripMentionMarkup)
      } catch {
        return []
      }
    },
    signal: signalOf(),
  }
}
import type { RunTaskState } from '../../../../features/shared/execution/runEngine'
