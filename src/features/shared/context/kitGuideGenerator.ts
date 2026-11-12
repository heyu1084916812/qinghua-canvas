import type { Channel } from '../../../domain/project/channel'
import { runRouteCandidatesOf } from '../../../domain/project/generationRouting'
import { capabilityOfLogical, toLogicalName } from '../../../domain/project/modelCatalog'
import type { RoutePlanResult } from '../../../domain/project/routePlan'
import type {
  ContextKitAsset,
  ContextKitColor,
  ContextKitFont,
  ContextKitKind,
} from '../../../domain/shared/context'
import type { NodeInput, ToolDeclaration, ChatMessage } from '../../../domain/shared/execution/types'
import { imageSizeFromHeader } from '../../../domain/shared/imageSize'
import {
  KIT_GUIDE_SYSTEM_PROMPT,
  buildKitGuidePrompt,
  formatKitGuide,
  parseKitGuideText,
  redactSecrets,
} from '../../../domain/shared/kitGuide'
import type { TextResult } from '../../../platform/channels/types'
import { directTextTrace, type DirectRunRouteCandidate, type DirectRunTraceInput } from '../../../state/shared/directRun'

/**
 * 套件设计指南生成：把套件图片 + 已登记颜色 / 字体名 + 资料文字发给用户配置的、能看图的对话模型。
 *
 * 模型与渠道走与 Agent 视觉调用同一条管道：
 * 「视觉验收模型」（设置里单独选的看图模型）优先，其次 Agent 默认模型，再次第一个
 * 已启用且声明支持图片输入的对话模型；路由经 `planGenerationRoute` 生成 RoutePlan，
 * 请求经 `completeWithTools`（凭据、降级、RunRecord 都在执行层）。本模块不读 Key、不打日志。
 */

export const MAX_KIT_GUIDE_IMAGES = 8

export interface KitGuideChannelPort {
  getState(): { channels: Channel[] }
  globalModelsOf(category: 'chat'): { id: string }[]
  planGenerationRoute(opts: { category: 'chat'; logicalModel: string }): Promise<RoutePlanResult>
  completeWithTools(req: {
    channelId: string
    model: string
    modelIsUpstream?: boolean
    tools: readonly ToolDeclaration[]
    messages: readonly ChatMessage[]
    inputs?: readonly NodeInput[]
    signal: AbortSignal
    timeoutMs?: number
    routeCandidates?: readonly DirectRunRouteCandidate[]
    routePlanId?: string
    trace: DirectRunTraceInput
  }): Promise<TextResult>
}

export interface KitGuidePresetPort {
  loadAgentReviewModel(): Promise<string | null>
  loadAgentDefault(): Promise<{ model: string } | null>
}

export interface KitGuideDeps {
  channels: KitGuideChannelPort
  presets: KitGuidePresetPort
  assets: { read(hash: string): Promise<{ bytes: Uint8Array; mime: string } | null> }
}

export interface KitGuideRequest {
  kitId: string
  projectId: string
  kind: ContextKitKind
  name: string
  description: string
  resources: readonly ContextKitAsset[]
  colors: readonly ContextKitColor[]
  fonts: readonly ContextKitFont[]
  sourceTexts?: readonly { label: string; text: string }[]
  signal: AbortSignal
}

export type KitGuideOutcome =
  | { ok: true; text: string; model: string; limitations: string[] }
  | { ok: false; message: string; cancelled?: boolean }

interface VisionRoute {
  channelId: string
  logicalModel: string
  upstreamModel: string
  routePlanId: string
  candidates: DirectRunRouteCandidate[]
}

function supportsImages(channels: readonly Channel[], model: string): boolean {
  return capabilityOfLogical(channels, model)?.inputTypes.includes('image') === true
}

export async function resolveKitVisionRoute(
  deps: Pick<KitGuideDeps, 'channels' | 'presets'>,
): Promise<{ ok: true; route: VisionRoute } | { ok: false; message: string }> {
  const channels = deps.channels.getState().channels
  const enabled = channels.filter((channel) => channel.enabled)
  const [review, agentDefault] = await Promise.all([
    deps.presets.loadAgentReviewModel().catch(() => null),
    deps.presets.loadAgentDefault().catch(() => null),
  ])
  const ordered = [
    review ?? '',
    agentDefault?.model ?? '',
    ...deps.channels.globalModelsOf('chat').map((model) => model.id),
  ]
    .map((name) => (name ? toLogicalName(channels, name) || name.trim() : ''))
    .filter(Boolean)
  const tried = new Set<string>()
  let lastReason = ''
  for (const logicalModel of ordered) {
    if (tried.has(logicalModel)) continue
    tried.add(logicalModel)
    if (!supportsImages(enabled, logicalModel)) continue
    const planned = await deps.channels.planGenerationRoute({ category: 'chat', logicalModel })
    if (!planned.ok) {
      lastReason = planned.reason === 'no_token' ? `「${logicalModel}」的 Key 还未配置` : ''
      continue
    }
    const candidates = runRouteCandidatesOf(planned.plan)
    const first = candidates[0]
    if (!first) continue
    return {
      ok: true,
      route: {
        channelId: first.channelId,
        logicalModel,
        upstreamModel: first.model,
        routePlanId: `${planned.plan.logicalModel}:${planned.plan.capability}:${planned.plan.strategy}`,
        candidates,
      },
    }
  }
  return {
    ok: false,
    message:
      lastReason ||
      '没有可用的看图对话模型：请在「Agent 设置 → 模型 → 视觉验收模型」选择一个支持图片输入的对话模型',
  }
}

async function prepareImages(
  resources: readonly ContextKitAsset[],
  assets: KitGuideDeps['assets'],
): Promise<{ inputs: NodeInput[]; labels: string[]; limitations: string[] }> {
  const inputs: NodeInput[] = []
  const labels: string[] = []
  const limitations: string[] = []
  const ordered = [
    ...resources.filter((resource) => resource.role === 'logo'),
    ...resources.filter((resource) => resource.role !== 'logo'),
  ]
  const seen = new Set<string>()
  for (const resource of ordered) {
    if (!resource.hash || seen.has(resource.hash)) continue
    seen.add(resource.hash)
    if (inputs.length >= MAX_KIT_GUIDE_IMAGES) {
      limitations.push(`只提交前 ${MAX_KIT_GUIDE_IMAGES} 张图片`)
      break
    }
    const payload = await assets.read(resource.hash).catch(() => null)
    const label = `${resource.role === 'logo' ? 'Logo' : '参考图'}「${resource.name || resource.hash.slice(0, 6)}」`
    if (!payload?.bytes.length || !payload.mime.toLowerCase().startsWith('image/')) {
      limitations.push(`${label} 读不到图片字节，已跳过`)
      continue
    }
    const size = imageSizeFromHeader(payload.bytes)
    inputs.push({
      kind: 'asset',
      nodeId: `kit-guide:${resource.role}:${resource.hash}`,
      assetHash: resource.hash,
      mime: payload.mime,
      ...(size && size.width > 0 && size.height > 0 ? { naturalSize: size } : {}),
    })
    labels.push(label)
  }
  return { inputs, labels, limitations }
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true
  const row = error as { name?: string; detail?: string } | null
  return row?.name === 'AbortError' || row?.detail === 'aborted'
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  const row = error as { message?: unknown; detail?: unknown; status?: unknown } | null
  if (typeof row?.message === 'string') return row.message
  if (typeof row?.status === 'number') return `HTTP ${row.status}`
  if (typeof row?.detail === 'string') return row.detail
  return '生成设计指南失败'
}

export async function generateKitGuide(
  deps: KitGuideDeps,
  request: KitGuideRequest,
): Promise<KitGuideOutcome> {
  const cancelled = { ok: false as const, message: '已取消生成', cancelled: true }
  if (request.signal.aborted) return cancelled
  const sources = (request.sourceTexts ?? []).filter((source) => source.text.trim())
  if (request.resources.length === 0 && sources.length === 0 && request.colors.length === 0) {
    return { ok: false, message: '先添加 Logo、参考图或导入品牌手册，再生成设计指南' }
  }
  const resolved = await resolveKitVisionRoute(deps)
  if (!resolved.ok) return resolved
  const { route } = resolved
  const images = await prepareImages(request.resources, deps.assets)
  if (request.signal.aborted) return cancelled
  if (images.inputs.length === 0 && sources.length === 0 && request.colors.length === 0) {
    return { ok: false, message: images.limitations[0] ?? '素材都读不到，无法生成设计指南' }
  }
  const prompt = buildKitGuidePrompt({
    kind: request.kind,
    name: request.name,
    description: request.description,
    colors: request.colors,
    fonts: request.fonts,
    imageLabels: images.labels,
    sourceTexts: sources,
  })
  try {
    const result = await deps.channels.completeWithTools({
      channelId: route.channelId,
      model: route.upstreamModel,
      modelIsUpstream: true,
      tools: [],
      messages: [
        { role: 'system', content: KIT_GUIDE_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      inputs: images.inputs,
      signal: request.signal,
      timeoutMs: 120_000,
      routeCandidates: route.candidates,
      routePlanId: route.routePlanId,
      trace: directTextTrace({
        projectId: request.projectId || 'context-kits',
        workbench: 'canvas',
        subjectId: request.kitId || 'new-kit',
        scopeId: `context-kit:${request.kitId || 'new'}`,
        operationId: `kit-guide:${Date.now()}`,
        purpose: 'context-kit-guide',
        channelId: route.channelId,
        model: route.upstreamModel,
        prompt,
        inputs: images.inputs,
        params: { imageCount: images.inputs.length, sourceCount: sources.length },
      }),
    })
    if (request.signal.aborted) return cancelled
    const parsed = parseKitGuideText(result.text, request.colors)
    if (!parsed.ok) return { ok: false, message: parsed.reason }
    return {
      ok: true,
      text: formatKitGuide(parsed.guide),
      model: route.logicalModel,
      limitations: images.limitations,
    }
  } catch (error) {
    if (isAbort(error, request.signal)) return cancelled
    return { ok: false, message: redactSecrets(`生成失败：${messageOf(error)}`) }
  }
}
