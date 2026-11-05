import type { Channel } from '../../domain/project/channel'
import { resolveUpstreamModel } from '../../domain/project/modelMapping'
import { formatContextBundleForPrompt } from '../../domain/shared/context'
import type { ChatMessage, NodeInput, ToolDeclaration } from '../../domain/shared/execution/types'
import type { GeneratedAsset, SpeechRunRequest, TextResult, VideoRunRequest } from '../../platform/channels/types'
import { ChannelError } from '../../platform/channels/types'
import type { PlatformKit, StreamChunk } from '../../platform/ports'
import type { GenerationClient } from '../../platform/generation/generationClient'
import {
  runDirectGeneration,
  type DirectRunRouteCandidate,
  type DirectRunTraceInput,
} from '../shared/directRun'
import { ChannelRemovalInterruptedError } from '../shared/runChannelGuard'
import type { ContextRepository } from '../shared/contextRepository'

const AGENT_CHAT_TIMEOUT_MS = 180_000

export interface ChannelRequestOrchestration {
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
    trace?: DirectRunTraceInput
    onRecordWarning?: (warning: string) => void
    onRouteSucceeded?: (route: DirectRunRouteCandidate) => void
    onChunk?: (chunk: StreamChunk) => void
  }): Promise<TextResult>
  generateSpeech(req: SpeechRunRequest & {
    signal: AbortSignal
    trace?: DirectRunTraceInput
  }): Promise<GeneratedAsset>
  generateVideo(req: VideoRunRequest & {
    signal: AbortSignal
    trace?: DirectRunTraceInput
  }): Promise<GeneratedAsset[]>
}

export function createChannelRequestOrchestration(deps: {
  platform: PlatformKit
  contextRepo: ContextRepository
  generation: GenerationClient
  channels: () => Channel[]
}): ChannelRequestOrchestration {
  const channelOf = (channelId: string): Channel => {
    const channel = deps.channels().find((item) => item.id === channelId)
    if (!channel) throw new ChannelError({ kind: 'channel', detail: 'missingChannel' })
    return channel
  }

  const missingChannel = (error: unknown): never => {
    if (error instanceof ChannelRemovalInterruptedError) {
      throw new ChannelError({ kind: 'channel', detail: 'missingChannel' })
    }
    throw error
  }

  return {
    async completeWithTools({
      channelId: requestedChannelId,
      model: requestedModel,
      modelIsUpstream = false,
      tools,
      messages,
      inputs = [],
      signal,
      timeoutMs,
      routeCandidates = [],
      routePlanId,
      trace,
      onRecordWarning,
      onRouteSucceeded,
      onChunk,
    }) {
      const traceParams =
        trace?.params && typeof trace.params === 'object'
          ? { ...(trace.params as Record<string, unknown>) }
          : {}
      let outboundMessages = messages
      const outboundInputs = [...inputs]
      let contextMeta: Record<string, unknown> = {}
      if (
        trace &&
        typeof traceParams.contextDigest !== 'string' &&
        traceParams.purpose !== 'agent-tool-probe'
      ) {
        try {
          const lastUser = [...messages]
            .reverse()
            .find((message) => message.role === 'user')
          const bundle = await deps.contextRepo.bundleForProject({
            projectId: trace.projectId,
            workbench: trace.workbench,
            request: lastUser?.content ?? '',
            sessionId: trace.scopeId,
            taskId: trace.subjectId,
          })
          if (bundle.conflicts.length > 0) {
            throw new ChannelError({
              kind: 'parse',
              raw: `上下文有冲突，请先处理：${bundle.conflicts
                .map((conflict) => conflict.message)
                .join('；')}`,
            })
          }
          const contextPrompt = formatContextBundleForPrompt(bundle)
          if (contextPrompt) {
            outboundMessages = [
              { role: 'system', content: contextPrompt },
              ...messages,
            ]
          }
          contextMeta = {
            contextDigest: bundle.digest,
            memoryRefs: bundle.memoryRefs,
            kitVersionRefs: bundle.kitVersionRefs,
          }
          const existingAssetHashes = new Set(
            outboundInputs.flatMap((input) =>
              input.kind === 'asset' ? [input.assetHash] : [],
            ),
          )
          for (const hash of bundle.assetHashes) {
            if (existingAssetHashes.has(hash)) continue
            const payload = await deps.platform.assets.read(hash).catch(() => null)
            if (!payload) continue
            existingAssetHashes.add(hash)
            outboundInputs.push({
              kind: 'asset',
              nodeId: `context-kit:${hash}`,
              assetHash: hash,
              mime: payload.mime,
            })
          }
        } catch (error) {
          if (error instanceof ChannelError) throw error
          // 记忆 / 套件读取失败不能阻断正常付费调用；本次按“无长期上下文”继续。
        }
      }
      const effectiveTrace = trace
        ? {
            ...trace,
            params: { ...traceParams, ...contextMeta },
          }
        : undefined
      const firstChannel = channelOf(requestedChannelId)
      const firstSentModel = modelIsUpstream
        ? requestedModel
        : resolveUpstreamModel(firstChannel.modelMap, requestedModel) ?? requestedModel
      const candidates: readonly DirectRunRouteCandidate[] =
        routeCandidates.length > 0
          ? routeCandidates
          : [{
              channelId: requestedChannelId,
              model: modelIsUpstream ? requestedModel : firstSentModel,
            }]
      const isFrozenRoute = (route: DirectRunRouteCandidate | undefined): boolean =>
        Boolean(
          route &&
            routeCandidates.some(
              (candidate) =>
                candidate.channelId === route.channelId &&
                candidate.credentialGroupId === route.credentialGroupId &&
                candidate.model === route.model,
            ),
        )
      const call = (
        callSignal: AbortSignal,
        route: DirectRunRouteCandidate | undefined,
      ) => {
        const selected = route ?? candidates[0]!
        const ch = channelOf(selected.channelId)
        const args = {
          channel: ch,
          model: selected.model,
          request: {
            kind: 'text' as const,
            prompt: '',
            inputs: outboundInputs,
            params: {},
            tools,
            messages: outboundMessages,
            timeoutMs: timeoutMs ?? AGENT_CHAT_TIMEOUT_MS,
          },
          hints: {
            modelIsUpstream: isFrozenRoute(route) || modelIsUpstream,
            ...(selected.credentialGroupId
              ? { credentialGroupId: selected.credentialGroupId }
              : {}),
            operationId:
              effectiveTrace?.operationId ??
              `text:${selected.channelId}:${selected.model}`,
          },
        }
        return onChunk
          ? deps.generation.streamText(args, callSignal, onChunk)
          : deps.generation.completeText(args, callSignal)
      }
      if (!effectiveTrace) return call(signal, candidates[0])
      const firstCandidate = candidates[0]!
      try {
        const finished = await runDirectGeneration({
          storage: deps.platform.storage,
          trace: {
            ...effectiveTrace,
            inputs: outboundInputs,
            sentChannelId: firstCandidate.channelId,
            sentModel: firstCandidate.model,
            ...(routePlanId ? { routePlanId } : {}),
          },
          channelId: firstCandidate.channelId,
          routeCandidates: candidates,
          signal,
          call,
          outputHashesOf: () => [],
          ...(onRecordWarning ? { onRecordWarning } : {}),
        })
        if (finished.record.sentChannelId && finished.record.sentModel) {
          onRouteSucceeded?.({
            channelId: finished.record.sentChannelId,
            ...(finished.record.credentialGroupId
              ? { credentialGroupId: finished.record.credentialGroupId }
              : {}),
            model: finished.record.sentModel,
          })
        }
        return finished.result
      } catch (error) {
        return missingChannel(error)
      }
    },
    async generateSpeech({
      signal,
      channelId,
      model,
      text,
      voice,
      speed,
      responseFormat,
      timeoutMs,
      trace,
    }) {
      const ch = channelOf(channelId)
      const call = (callSignal: AbortSignal) => deps.generation.generateSpeech(
        {
          channel: ch,
          model,
          request: {
            text,
            voice,
            ...(speed !== undefined ? { speed } : {}),
            ...(responseFormat ? { responseFormat } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          },
          hints: {
            operationId: `speech:${channelId}:${model}`,
          },
        },
        callSignal,
      )
      if (!trace) return call(signal)
      try {
        return (
          await runDirectGeneration({
            storage: deps.platform.storage,
            trace,
            channelId,
            signal,
            call,
            outputHashesOf: (result) => [result.hash],
            outputAssetOf: (result) => result,
          })
        ).result
      } catch (error) {
        return missingChannel(error)
      }
    },
    async generateVideo({
      signal,
      channelId,
      model,
      trace,
      ...request
    }) {
      const ch = channelOf(channelId)
      const call = (callSignal: AbortSignal) => deps.generation.generateVideo(
        {
          channel: ch,
          model,
          request,
          hints: {
            operationId: `video:${channelId}:${model}`,
          },
        },
        callSignal,
      )
      if (!trace) return call(signal)
      try {
        return (
          await runDirectGeneration({
            storage: deps.platform.storage,
            trace: {
              ...trace,
              sentChannelId: trace.sentChannelId ?? channelId,
              inputs: trace.inputs ?? request.inputs,
            },
            channelId,
            signal,
            call,
            outputHashesOf: (result) => result.map((asset) => asset.hash),
            outputAssetOf: (result) => result[0],
          })
        ).result
      } catch (error) {
        return missingChannel(error)
      }
    },
  }
}
