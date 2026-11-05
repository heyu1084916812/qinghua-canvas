import {
  buildShotsReviewSystem,
  buildShotsReviewText,
  buildShotsSystem,
  buildShotsText,
  parseShotsReply,
  type ShotPlanResult,
} from '../../../domain/ecommerce/chatShots'
import type { EcommercePlatform } from '../../../domain/ecommerce/platforms'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { EcommerceIntentDraft } from '../../../domain/ecommerce/chatParse'
import type { EcommerceGenerationStage } from '../../../domain/ecommerce/progress'
import type { NodeInput } from '../../../domain/shared/execution/types'
import { directTextTrace, type DirectRunTraceInput } from '../../../state/shared/directRun'
import { asAppError, describeError } from '../../../shared/result'

export interface EcommerceChatTarget {
  channelId: string
  logicalModel: string
  upstreamModel: string
}

export interface EcommerceTextRequestPorts {
  projectId: string
  chatTarget: EcommerceChatTarget
  operationId: string
  completeWithTools(request: {
    channelId: string
    model: string
    modelIsUpstream: true
    tools: []
    messages: { role: 'system' | 'user'; content: string }[]
    inputs?: readonly Extract<NodeInput, { kind: 'asset' }>[]
    signal: AbortSignal
    trace: DirectRunTraceInput
    onRecordWarning(warning: string): void
  }): Promise<{ text: string }>
  directTextTrace: typeof directTextTrace
  onRecordWarning(warning: string): void
  abortSignal(): AbortSignal
  clearTimer(): void
}

function semanticError(error: unknown, aborted: boolean, timeoutMessage: string, fallback: string): string {
  if (aborted) return timeoutMessage
  const appError = asAppError(error)
  return appError ? describeError(appError) : fallback
}

/** Parse one short intent text with a 30-second caller-owned timeout and warning sink. */
export async function requestEcommerceIntent(
  ports: EcommerceTextRequestPorts,
  input: {
    text: string
    platforms: readonly EcommercePlatform[]
    buildSystem(): string
    buildUser(text: string, platforms: readonly EcommercePlatform[]): string
    parse(text: string, args: { platforms: readonly EcommercePlatform[]; fallbackNote: string }):
      | { ok: true; draft: EcommerceIntentDraft }
      | { ok: false; error: string }
  },
): Promise<{ ok: true; draft: EcommerceIntentDraft } | { ok: false; error: string }> {
  const signal = ports.abortSignal()
  try {
    const result = await ports.completeWithTools({
      channelId: ports.chatTarget.channelId,
      model: ports.chatTarget.upstreamModel,
      modelIsUpstream: true,
      tools: [],
      messages: [
        { role: 'system', content: input.buildSystem() },
        { role: 'user', content: input.buildUser(input.text, input.platforms) },
      ],
      signal,
      trace: ports.directTextTrace({
        projectId: ports.projectId,
        workbench: 'ecommerce',
        subjectId: `project:${ports.projectId}:intent`,
        scopeId: `session:${ports.operationId}`,
        operationId: ports.operationId,
        purpose: 'ecommerce-intent',
        channelId: ports.chatTarget.channelId,
        model: ports.chatTarget.upstreamModel,
        prompt: input.text,
        params: { messageCount: 2 },
      }),
      onRecordWarning: ports.onRecordWarning,
    })
    return input.parse(result.text, { platforms: input.platforms, fallbackNote: input.text })
  } catch (error) {
    return {
      ok: false,
      error: semanticError(
        error,
        signal.aborted,
        '解析超时（30 秒没回）。稍后再试，或直接填表单。',
        '解析失败：这次没能拿到结果，稍后再试。',
      ),
    }
  } finally {
    ports.clearTimer()
  }
}

/** AI selling points: only facts supplied by the request, fenced replies removed, length capped. */
export async function requestEcommerceSellingPoints(
  ports: EcommerceTextRequestPorts,
  input: {
    request: EcommerceRequest
    platformsWithName: readonly { id: string; name: string }[]
    systemPrompt: string
    languageLabel(language: EcommerceRequest['language']): string
  },
): Promise<string> {
  const signal = ports.abortSignal()
  const platform =
    input.platformsWithName.find((item) => item.id === input.request.platformId)?.name ?? '通用'
  const userText = [
    `功能：${input.request.modeLabel ?? '电商图片'}`,
    `平台：${platform}`,
    `文案语言：${input.languageLabel(input.request.language)}`,
    `用户已有要求：${input.request.note?.trim() || '无'}`,
    `专属配置：${input.request.modePrompt?.trim() || '无'}`,
  ].join('\n')
  try {
    const result = await ports.completeWithTools({
      channelId: ports.chatTarget.channelId,
      model: ports.chatTarget.upstreamModel,
      modelIsUpstream: true,
      tools: [],
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: userText },
      ],
      signal,
      trace: ports.directTextTrace({
        projectId: ports.projectId,
        workbench: 'ecommerce',
        subjectId:
          input.request.productNodeId ||
          input.request.productNodeIds?.[0] ||
          `project:${ports.projectId}:selling-points`,
        scopeId: `session:${ports.operationId}`,
        operationId: ports.operationId,
        purpose: 'ecommerce-selling-points',
        channelId: ports.chatTarget.channelId,
        model: ports.chatTarget.upstreamModel,
        prompt: userText,
        params: { messageCount: 2, mode: input.request.modeLabel ?? '' },
      }),
      onRecordWarning: ports.onRecordWarning,
    })
    const text = result.text.trim().replace(/^```(?:text)?\s*|\s*```$/g, '').trim()
    if (!text) throw new Error('模型没有返回可用的卖点文案')
    return text.slice(0, 500)
  } catch (error) {
    if (signal.aborted) throw new Error('AI 帮写超时（30 秒没回），请稍后重试')
    const appError = asAppError(error)
    throw new Error(appError ? describeError(appError) : 'AI 帮写失败，请稍后重试')
  } finally {
    ports.clearTimer()
  }
}

export interface EcommerceShotRequestPorts extends EcommerceTextRequestPorts {
  visualInputs: readonly Extract<NodeInput, { kind: 'asset' }>[]
  platforms: readonly EcommercePlatform[]
  setStage(stage: EcommerceGenerationStage): void
}

/** Two-pass shot planning: each pass must return a full valid schema; any failure stops before paid generation. */
export async function requestEcommerceShots(
  ports: EcommerceShotRequestPorts,
  request: EcommerceRequest,
): Promise<ShotPlanResult> {
  const subjectId = ports.visualInputs[0]?.nodeId || `project:${ports.projectId}:shot-plan`
  ports.setStage({
    phase: 'analyze',
    label: '正在分析商品原图与需求',
    detail: `已附 ${ports.visualInputs.length} 张视觉素材`,
  })
  const runPass = async (
    system: string,
    user: string,
    timeoutMessage: string,
    purpose: 'ecommerce-shots' | 'ecommerce-review',
  ): Promise<{ ok: true; text: string } | { ok: false; error: string }> => {
    const signal = ports.abortSignal()
    try {
      const result = await ports.completeWithTools({
        channelId: ports.chatTarget.channelId,
        model: ports.chatTarget.upstreamModel,
        modelIsUpstream: true,
        tools: [],
        inputs: ports.visualInputs,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        signal,
        trace: ports.directTextTrace({
          projectId: ports.projectId,
          workbench: 'ecommerce',
          subjectId,
          scopeId: `session:${ports.operationId}`,
          operationId: ports.operationId,
          purpose,
          channelId: ports.chatTarget.channelId,
          model: ports.chatTarget.upstreamModel,
          prompt: user,
          inputs: [...ports.visualInputs],
          params: {
            messageCount: 2,
            count: request.count,
            mode: request.modeLabel ?? '',
          },
        }),
        onRecordWarning: ports.onRecordWarning,
      })
      return { ok: true, text: result.text }
    } catch (error) {
      return {
        ok: false,
        error: semanticError(error, signal.aborted, timeoutMessage, '对话模型请求失败。'),
      }
    } finally {
      ports.clearTimer()
    }
  }
  const draftPass = await runPass(
    buildShotsSystem(),
    buildShotsText(request, ports.platforms, ports.visualInputs.length),
    '商品分析与提示词请求超时（60 秒没回）。',
    'ecommerce-shots',
  )
  if (!draftPass.ok) return draftPass
  const draft = parseShotsReply(draftPass.text, request.count, {
    usage: request.usage,
    ratio: request.ratio,
  })
  if (!draft.ok) return draft

  ports.setStage({
    phase: 'prompts',
    label: 'AI 正在自审并修正方案',
    detail: `逐项检查 ${request.count} 张的模块覆盖、文字、网格与视觉一致性`,
  })
  const reviewPass = await runPass(
    buildShotsReviewSystem(),
    buildShotsReviewText(
      request,
      {
        productAnalysis: { summary: draft.analysis },
        designSystem: draft.designSystem,
        shots: draft.shots.map((shot) => ({
          title: shot.title,
          brief: shot.brief,
          prompt: shot.prompt,
          ...(shot.ratio ? { ratio: shot.ratio } : {}),
          ...(shot.headline ? { headline: shot.headline } : {}),
          ...(shot.subheadline ? { subheadline: shot.subheadline } : {}),
        })),
      },
      ports.platforms,
      ports.visualInputs.length,
    ),
    'AI 自审方案超时（60 秒没回）。',
    'ecommerce-review',
  )
  if (!reviewPass.ok) return { ok: false, error: `AI 自审失败：${reviewPass.error}` }
  const reviewed = parseShotsReply(reviewPass.text, request.count, {
    usage: request.usage,
    ratio: request.ratio,
  })
  if (!reviewed.ok) return { ok: false, error: `AI 自审后的方案不合格：${reviewed.error}` }
  ports.setStage({
    phase: 'prompts',
    label: '逐张提示词已通过自审',
    detail: reviewed.analysis,
  })
  return {
    ok: true,
    shots: reviewed.shots,
    analysis: reviewed.analysis,
    designSystem: reviewed.designSystem,
  }
}
