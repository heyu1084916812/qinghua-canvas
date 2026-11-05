import type { RunPlan } from '../../../features/canvas/execution/buildRunPlan'
import type { RunRequest, RunRouteCandidate } from '../../../domain/shared/execution/types'
import type { Channel } from '../../../domain/project/channel'
import { protocolNeedsNoToken } from '../../../domain/project/channel'
import { applyRoutePlanToRequest } from '../../../domain/project/generationRouting'
import { resolveUpstreamModel } from '../../../domain/project/modelMapping'
import {
  resolveNodeRoute,
  type RouteChannelSource,
  type RouteStrategy,
} from '../../../domain/project/modelRouting'
import type { RoutePlanResult } from '../../../domain/project/routePlan'
import type { ChannelAdapter } from '../../../platform/channels/types'
import {
  asAppError,
  describeError,
  type AppError,
} from '../../../shared/result'

export interface CanvasRunPreflightFailure {
  taskId: string
  nodeId: string
  error: AppError
  message: string
}

export class CanvasRunPreflightError extends Error {
  readonly failures: readonly CanvasRunPreflightFailure[]

  constructor(failures: readonly CanvasRunPreflightFailure[]) {
    super(failures.map((failure) => failure.message).join('；'))
    this.name = 'CanvasRunPreflightError'
    this.failures = failures
  }
}

export type CanvasRunLaunchFailure = {
  ok: false
  canceled: boolean
  failures: readonly CanvasRunPreflightFailure[]
}

export type CanvasRunLaunchResult =
  | { ok: true }
  | CanvasRunLaunchFailure

export type CanvasRunPreflightResult =
  | {
      ok: true
      adapters: Map<string, ChannelAdapter>
      taskChannels: ReadonlyMap<string, string | readonly string[]>
    }
  | CanvasRunLaunchFailure

export interface CanvasRunPreflightInput {
  plan: RunPlan
  signal?: AbortSignal
  channels: () => readonly Channel[]
  currentChannels: () => readonly Channel[]
  routeStrategy: () => RouteStrategy
  hasLocalCli: boolean
  loadCredential: (credentialRef: string) => Promise<unknown>
  planGenerationRoute: (opts: {
    category: 'image' | 'video' | 'chat'
    logicalModel: string
    explicitChannelId?: string
  }) => Promise<RoutePlanResult>
  resolveAdapter: (input: {
    channel: Channel
    model: string
    kind: RunRequest['kind']
    credentialGroupId?: string
  }) => Promise<ChannelAdapter>
  random?: number
}

export function canceledRun(): CanvasRunLaunchFailure {
  return { ok: false, canceled: true, failures: [] }
}

export function failedRun(
  taskId: string,
  nodeId: string,
  message: string,
): CanvasRunLaunchFailure {
  return {
    ok: false,
    canceled: false,
    failures: [{
      taskId,
      nodeId,
      error: { kind: 'validation', field: 'run', reason: message },
      message,
    }],
  }
}

export function adapterKey(
  channelId: string,
  credentialGroupId: string | undefined,
  kind: RunRequest['kind'],
): string {
  return `${channelId}\u0000${credentialGroupId ?? ''}\u0000${kind}`
}

function allTaskFailures(
  plan: RunPlan,
  failures: readonly CanvasRunPreflightFailure[],
): CanvasRunPreflightFailure[] {
  const failureByTask = new Map(
    failures.map((failure) => [failure.taskId, failure] as const),
  )
  return plan.tasks.map((task) => {
    const current = failureByTask.get(task.id)
    if (current) return current
    return {
      taskId: task.id,
      nodeId: task.nodeId,
      error: {
        kind: 'validation',
        field: 'runPlan',
        reason: '同批任务预检失败，整批未启动',
      },
      message: '同批任务预检失败，整批未启动',
    }
  })
}

function failedPreflight(
  plan: RunPlan,
  failures: readonly CanvasRunPreflightFailure[],
): CanvasRunPreflightResult {
  return {
    ok: false,
    canceled: false,
    failures: allTaskFailures(plan, failures),
  }
}

export async function prepareCanvasRun(
  input: CanvasRunPreflightInput,
): Promise<CanvasRunPreflightResult> {
  const { plan, signal } = input
  if (signal?.aborted) return canceledRun()

  const all = input.channels()
  const tokenFlags = new Map<string, boolean>()
  for (const channel of all) {
    if (protocolNeedsNoToken(channel.protocol, input.hasLocalCli)) {
      tokenFlags.set(channel.id, true)
      continue
    }
    tokenFlags.set(
      channel.id,
      channel.credentialRef
        ? (await input.loadCredential(channel.credentialRef)) != null
        : false,
    )
  }
  if (signal?.aborted) return canceledRun()

  const sources: RouteChannelSource[] = all.map((channel) => ({
    id: channel.id,
    enabled: channel.enabled,
    hasToken: tokenFlags.get(channel.id) ?? false,
    priority: channel.priority,
    weight: channel.weight,
    lastTestLatency: channel.lastTestLatency,
    modelIds: channel.models.map((model) => model.id),
    modelMap: channel.modelMap,
    credentialGroups: channel.credentialGroups.map((group) => ({
      id: group.id,
      hasToken: group.hasToken,
      priority: group.priority,
      modelIds: group.models.map((model) => model.id),
    })),
  }))
  const strategy = input.routeStrategy()
  const failures: CanvasRunPreflightFailure[] = []

  for (const task of plan.tasks) {
    if (signal?.aborted) return canceledRun()
    const logical = task.request.model
    const explicitChannelId = task.request.channelId.trim()
    const routed = resolveNodeRoute(sources, logical, explicitChannelId, {
      strategy,
      resolve: resolveUpstreamModel,
      random: input.random ?? Math.random(),
      fallbackFromExplicit: true,
    })
    if (!routed.ok) {
      const channelName =
        all.find((channel) => channel.id === explicitChannelId)?.name ??
        explicitChannelId
      const failure: AppError =
        routed.reason === 'channel_missing'
          ? { kind: 'channel', detail: 'missingChannel' }
          : routed.reason === 'channel_no_token'
            ? { kind: 'channel', detail: 'missingKey' }
            : routed.reason === 'model_missing' || routed.reason === 'no_provider'
              ? { kind: 'channel', detail: 'missingModel' }
              : {
                  kind: 'validation',
                  field: '平台',
                  reason: `渠道「${channelName}」已停用`,
                }
      const reason =
        routed.reason === 'channel_disabled'
          ? `节点指定的渠道「${channelName}」已停用`
          : routed.reason === 'channel_no_token'
            ? `节点指定的渠道「${channelName}」没有可用令牌`
            : routed.reason === 'channel_missing'
              ? `节点指定的渠道「${channelName}」已删除，生成已停止，请重新选择平台`
              : routed.reason === 'model_missing'
                ? `节点指定的渠道「${channelName}」没有提供模型「${logical}」`
                : null
      failures.push({
        taskId: task.id,
        nodeId: task.nodeId,
        error: failure,
        message:
          reason ??
          `没有渠道提供模型「${logical}」：请到后台设置的「模型管理」里勾选并配置映射`,
      })
      continue
    }

    const picked = routed.selection
    const routedChannelName =
      all.find((channel) => channel.id === picked.channelId)?.name ??
      picked.channelId
    const baseRequest = {
      ...task.request,
      channelId: picked.channelId,
      model: picked.upstreamModel,
      ...(picked.credentialGroupId
        ? {
            credentialGroupId: picked.credentialGroupId,
            credentialGroupIds: picked.credentialGroupIds,
          }
        : {}),
    } as RunRequest
    if (task.request.kind === 'image' || task.request.kind === 'video') {
      const routePlan = await input.planGenerationRoute({
        category: task.request.kind,
        logicalModel: logical,
        explicitChannelId: picked.channelId,
      })
      if (signal?.aborted) return canceledRun()
      if (!routePlan.ok) {
        const message =
          routePlan.reason === 'policy_excluded'
            ? `渠道「${routedChannelName}」不在当前路由范围内，生成已停止`
            : `渠道「${routedChannelName}」无法生成模型「${logical}」，生成已停止`
        failures.push({
          taskId: task.id,
          nodeId: task.nodeId,
          error: {
            kind: 'validation',
            field: '路由策略',
            reason: message,
          },
          message,
        })
        continue
      }
      task.request = applyRoutePlanToRequest(
        baseRequest,
        routePlan.plan,
        `${plan.id}:${task.id}:route`,
      )
    } else {
      task.request = baseRequest
    }
  }

  if (failures.length > 0) return failedPreflight(plan, failures)
  if (signal?.aborted) return canceledRun()

  const adapters = new Map<string, ChannelAdapter>()
  for (const task of plan.tasks) {
    if (signal?.aborted) return canceledRun()
    const candidates: RunRouteCandidate[] =
      task.request.routeCandidates?.length
        ? task.request.routeCandidates.map((candidate) => ({ ...candidate }))
        : (task.request.credentialGroupIds?.length
            ? task.request.credentialGroupIds
            : [task.request.credentialGroupId]
          ).map((groupId) => ({
            channelId: task.request.channelId,
            ...(groupId ? { credentialGroupId: groupId } : {}),
            model: task.request.model,
          }))
    for (const candidate of candidates) {
      const channel = all.find((item) => item.id === candidate.channelId)
      if (!channel) continue
      const mapKey = adapterKey(
        candidate.channelId,
        candidate.credentialGroupId,
        task.request.kind,
      )
      if (adapters.has(mapKey)) continue
      try {
        adapters.set(
          mapKey,
          await input.resolveAdapter({
            channel,
            model: candidate.model,
            kind: task.request.kind,
            ...(candidate.credentialGroupId
              ? { credentialGroupId: candidate.credentialGroupId }
              : {}),
          }),
        )
        if (signal?.aborted) return canceledRun()
      } catch (error) {
        const appError = asAppError(error)
        const message = appError
          ? `渠道「${channel.name}」无法执行：${describeError(appError)}`
          : `渠道「${channel.name}」无法执行：${String(error)}`
        failures.push({
          taskId: task.id,
          nodeId: task.nodeId,
          error: appError ?? { kind: 'parse', raw: String(error) },
          message,
        })
      }
    }
  }

  if (failures.length > 0) return failedPreflight(plan, failures)
  if (signal?.aborted) return canceledRun()

  const currentChannels = new Map(
    input.currentChannels().map((channel) => [channel.id, channel]),
  )
  const vanished = plan.tasks.filter((task) => {
    const usedChannels = task.request.routeCandidates?.length
      ? task.request.routeCandidates.map((candidate) => candidate.channelId)
      : [task.request.channelId]
    return usedChannels.some((channelId) => !currentChannels.has(channelId))
  })
  if (vanished.length > 0) {
    return failedPreflight(
      plan,
      vanished.map((task) => ({
        taskId: task.id,
        nodeId: task.nodeId,
        error: { kind: 'channel', detail: 'missingChannel' },
        message: '渠道已删除，生成已停止；请重新选择平台后再生成',
      })),
    )
  }

  const taskChannels = new Map<string, string | readonly string[]>(
    plan.tasks.map((task) => [
      task.id,
      task.request.routeCandidates?.length
        ? [...new Set(task.request.routeCandidates.map((candidate) => candidate.channelId))]
        : task.request.channelId,
    ]),
  )
  return { ok: true, adapters, taskChannels }
}
