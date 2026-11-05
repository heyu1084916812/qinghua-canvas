import type { ModelCapability } from '../../../domain/shared/capability'
import { classifyError, isModelListBody, toModelCapability } from '../openaiCommon'
import { ChannelError, type ChannelAdapter } from '../types'
import type {
  OpenAiAdapterConfig,
  OpenAiImagesCore,
  OpenAiImagesOptions,
} from './contracts'
import { createGeneratedAssetFactory } from './generatedAssets'
import { generateImage } from './generateImage'
import {
  submitNetwork,
  waitFor,
} from './errorNormalization'
import {
  authHeader,
  openAiBaseUrl,
  VERIFY_TIMEOUT_MS,
} from '../openaiCommon'

export function createOpenAiImagesAdapterFromCore(
  core: OpenAiImagesCore,
): ChannelAdapter {
  const assets = createGeneratedAssetFactory(core)
  const verify: ChannelAdapter['verify'] = async (_cfg, signal) => {
    try {
      const res = await core.deps.network.request(
        {
          url: core.modelsUrl,
          method: 'GET',
          headers: authHeader(core.config.apiKey),
          timeoutMs: VERIFY_TIMEOUT_MS,
        },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        const detail = await res.text().catch(() => '')
        const { error, message } = classifyError(null, res.status, detail)
        return { ok: false, error, message }
      }
      const body = await res
        .json<{ data?: { id: string }[] }>()
        .catch(() => null)
      if (!isModelListBody(body)) {
        return {
          ok: false,
          error: { kind: 'channel', detail: 'unsupported' },
          message: '响应不是模型列表，该地址不像 OpenAI 兼容接口',
        }
      }
      const models: ModelCapability[] = body.data.map((m) =>
        toModelCapability(m.id),
      )
      return { ok: true, models }
    } catch (e) {
      const { error, message } = classifyError(e)
      return { ok: false, error, message }
    }
  }

  const listModels: ChannelAdapter['listModels'] = async (_cfg, signal) => {
    const res = await core.deps.network.request(
      {
        url: core.modelsUrl,
        method: 'GET',
        headers: authHeader(core.config.apiKey),
        timeoutMs: VERIFY_TIMEOUT_MS,
      },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res
      .json<{ data?: { id: string }[] }>()
      .catch(() => ({ data: [] as { id: string }[] }))
    return (body.data ?? []).map((m) => toModelCapability(m.id))
  }

  return {
    protocol: core.config.protocol,
    verify,
    listModels,
    generateImage: (request, signal) =>
      generateImage(core, assets, request, signal),
    async generateVideo() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
    async completeText() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
  }
}

export function createOpenAiImagesCore(
  config: OpenAiAdapterConfig,
  deps: Parameters<typeof createGeneratedAssetFactory>[0]['deps'],
  options: OpenAiImagesOptions = {},
): OpenAiImagesCore {
  const base = openAiBaseUrl(config)
  return {
    config,
    deps,
    base,
    modelsUrl: `${base}/models`,
    imagesUrl: `${base}/images/generations`,
    editsUrl: `${base}/images/edits`,
    chatUrl: `${base}/chat/completions`,
    imageResponseFormat: config.protocol === 'soonstudio' ? 'url' : 'b64_json',
    submitNetwork,
    pollInterval: options.soonStudioPollIntervalMs ?? 2_000,
    pollTimeout: options.soonStudioPollTimeoutMs ?? 8 * 60_000,
    maxPolls: options.soonStudioMaxPolls ?? 180,
    sleepFn: options.sleep ?? waitFor,
    now: options.now ?? (() => Date.now()),
  }
}
