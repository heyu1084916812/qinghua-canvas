import type { ChannelStore } from '../../../../state/channel/channelStore'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { PlatformKit } from '../../../../platform/ports'
import {
  VISUAL_REVIEW_SYSTEM_PROMPT,
  buildVisualReviewPrompt,
  finalizeVisualReviewResult,
  parseVisualReviewText,
  visualReviewGenerationBriefs,
  type VisualReviewResult,
} from '../../../../domain/agent/visualReview'
import {
  capabilityOfLogical,
  toLogicalName,
} from '../../../../domain/project/modelCatalog'
import {
  runRouteCandidatesOf,
} from '../../../../domain/project/generationRouting'
import { prepareVisualReviewImages } from '../../../../features/shared/agent/visualReviewRunner'
import type { ModelRoutePort } from '../../../../features/shared/agent/ModelRoutePort'
import type { RouteExecutionPort } from '../../../../features/shared/agent/RouteExecutionPort'
import { directTextTrace } from '../../../../state/shared/directRun'
import { errText } from '../../agent/agentLoop'
import type { AgentChatRoute } from './agentChatRoute'

export interface AgentVisualReviewContextTrace {
  assetRefs: readonly {
    hash: string
    mime: string
  }[]
  kitVersionRefs: readonly { kitId: string; version: number }[]
  brief?: string
}

export interface AgentVisualReviewDeps {
  store: Pick<CanvasStore, 'getSnapshot'>
  allChannels: ReturnType<ChannelStore['getState']>['channels']
  modelRoute: ModelRoutePort
  routeExecution: RouteExecutionPort
  platform: Pick<PlatformKit, 'assets'>
  onRecordWarning(warning: string): void
}

export async function runAgentVisualReview(
  deps: AgentVisualReviewDeps,
  input: {
    sessionId: string
    operationId: string
    route: AgentChatRoute | null
    reviewModel: string
    aliases?: ReadonlyMap<string, string>
    contextTrace?: AgentVisualReviewContextTrace
    signal?: AbortSignal
    review: {
      nodeIds: readonly string[]
      checklist?: string
    }
  },
): Promise<VisualReviewResult> {
  const graph = deps.store.getSnapshot()
  const requestedIds = [
    ...new Set(
      input.review.nodeIds.map((id) => input.aliases?.get(id) ?? id),
    ),
  ]
  const targetNodeIds = requestedIds.slice(0, 4)
  const limitations: string[] = []
  if (requestedIds.length > targetNodeIds.length) {
    limitations.push(
      `本次快速验收先看前 ${targetNodeIds.length} 张，另有 ${
        requestedIds.length - targetNodeIds.length
      } 张未提交；需要全量验收时再单独发起。`,
    )
  }
  if (!input.route) {
    return {
      ok: false,
      verdict: 'unreviewable',
      summary: '当前回合没有可用的视觉验收模型路由',
      issues: [],
      targetNodeIds,
      referenceAssetCount: 0,
      suiteContextAvailable: false,
      limitations: [...limitations, '请确认对话模型已配置并且支持图片输入'],
    }
  }

  let reviewRoute = input.route
  if (input.reviewModel.trim()) {
    const logicalModel =
      toLogicalName(deps.allChannels, input.reviewModel) ||
      input.reviewModel.trim()
    const capability = capabilityOfLogical(deps.allChannels, logicalModel)
    if (!capability?.inputTypes.includes('image')) {
      return {
        ok: false,
        verdict: 'unreviewable',
        summary: `视觉验收模型「${logicalModel}」不支持图片输入，请重新选择`,
        issues: [],
        targetNodeIds,
        referenceAssetCount: 0,
        suiteContextAvailable: false,
        limitations,
      }
    }
    const planned = await deps.modelRoute.plan({
      capability: 'chat',
      logicalModel,
    })
    if (!planned.ok) {
      return {
        ok: false,
        verdict: 'unreviewable',
        summary: `视觉验收模型「${logicalModel}」当前没有可路由的已启用渠道`,
        issues: [],
        targetNodeIds,
        referenceAssetCount: 0,
        suiteContextAvailable: false,
        limitations,
      }
    }
    const candidates = runRouteCandidatesOf(planned.plan)
    const first = candidates[0]
    if (!first) {
      return {
        ok: false,
        verdict: 'unreviewable',
        summary: `视觉验收模型「${logicalModel}」当前没有可路由的已启用渠道`,
        issues: [],
        targetNodeIds,
        referenceAssetCount: 0,
        suiteContextAvailable: false,
        limitations,
      }
    }
    reviewRoute = {
      channelId: first.channelId,
      ...(first.credentialGroupId
        ? { credentialGroupId: first.credentialGroupId }
        : {}),
      logicalModel,
      upstreamModel: first.model,
      routePlanId: `${planned.plan.logicalModel}:${planned.plan.capability}:${planned.plan.strategy}`,
      candidates,
    }
  } else if (
    !capabilityOfLogical(
      deps.allChannels,
      input.route.logicalModel,
    )?.inputTypes.includes('image')
  ) {
    return {
      ok: false,
      verdict: 'unreviewable',
      summary: `主模型「${input.route.logicalModel}」不支持图片输入，请先为视觉验收单独选择模型`,
      issues: [],
      targetNodeIds,
      referenceAssetCount: 0,
      suiteContextAvailable: false,
      limitations,
    }
  }

  const prepared = await prepareVisualReviewImages({
    graph,
    nodeIds: targetNodeIds,
    contextAssets: input.contextTrace?.assetRefs,
    readAsset: (hash) => deps.platform.assets.read(hash),
    maxTargets: 4,
    maxReferences: 4,
  })
  limitations.push(...prepared.limitations)
  const suiteContextAvailable =
    (input.contextTrace?.kitVersionRefs.length ?? 0) > 0 ||
    prepared.referenceAssetCount > 0

  if (prepared.targets.length === 0) {
    return {
      ok: false,
      verdict: 'unreviewable',
      summary: '没有可读取的目标图片，未执行视觉验收',
      issues: [],
      targetNodeIds,
      referenceAssetCount: prepared.referenceAssetCount,
      suiteContextAvailable,
      limitations,
    }
  }

  const generationBriefs = visualReviewGenerationBriefs(graph, targetNodeIds)
  const prompt = buildVisualReviewPrompt({
    targets: prepared.targets,
    ...(generationBriefs ? { targetBriefs: generationBriefs } : {}),
    ...(input.review.checklist
      ? { checklist: input.review.checklist }
      : {}),
    ...(input.contextTrace?.brief ? { context: input.contextTrace.brief } : {}),
    referenceAssetCount: prepared.referenceAssetCount,
    suiteContextAvailable,
  })
  const reviewInputs = [...prepared.targetInputs, ...prepared.contextInputs]
  try {
    const reviewed = await deps.routeExecution.execute({
      channelId: reviewRoute.channelId,
      model: reviewRoute.upstreamModel,
      modelIsUpstream: true,
      tools: [],
      messages: [
        { role: 'system', content: VISUAL_REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      inputs: reviewInputs,
      signal: input.signal ?? new AbortController().signal,
      routeCandidates: reviewRoute.candidates,
      routePlanId: reviewRoute.routePlanId,
      trace: directTextTrace({
        projectId: graph.projectId,
        workbench: 'canvas',
        subjectId: input.sessionId,
        scopeId: `session:${input.sessionId}`,
        operationId: input.operationId,
        purpose: 'agent-visual-review',
        channelId: reviewRoute.channelId,
        model: reviewRoute.upstreamModel,
        prompt,
        inputs: reviewInputs,
        params: {
          targetNodeIds,
          referenceAssetCount: prepared.referenceAssetCount,
          generationBriefs,
          checklist: input.review.checklist ?? '',
        },
      }),
      onRecordWarning: deps.onRecordWarning,
    })
    const parsed = parseVisualReviewText(reviewed.text, prepared.targets)
    const finalized = finalizeVisualReviewResult(parsed, {
      suiteContextAvailable,
    })
    return {
      ...finalized,
      referenceAssetCount: prepared.referenceAssetCount,
      limitations: [...limitations, ...finalized.limitations],
    }
  } catch (error) {
    return {
      ok: false,
      verdict: 'unreviewable',
      summary: `视觉验收请求失败：${errText(error)}`,
      issues: [],
      targetNodeIds,
      referenceAssetCount: prepared.referenceAssetCount,
      suiteContextAvailable,
      limitations,
    }
  }
}
