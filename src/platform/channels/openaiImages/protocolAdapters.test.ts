import { describe, expect, it } from 'vitest'
import { createMemoryNetwork, createMemoryPlatform } from '../../memory'
import type { ResolvedChannelConfig } from '../registry'
import type { ImageRunRequest } from '../types'
import type { NetworkResponse } from '../../ports'
import type { NetworkRequest } from '../../ports'
import { createOpenAiImagesCore } from './createAdapter'
import { generateChatImage } from './chatImageProtocol'
import { generateGeminiNativeImage } from './geminiImageProtocol'
import { createGeneratedAssetFactory } from './generatedAssets'
import { imageParamsFor } from '../../../domain/canvas/layout/imageParams'

const cfg: ResolvedChannelConfig = {
  id: 'c',
  protocol: 'openai-images',
  baseUrl: 'https://x',
  credentialRef: null,
  modelCache: [],
  apiKey: 'k',
}

const signal = new AbortController().signal

function response(status: number, body: unknown, mime = ''): NetworkResponse {
  return {
    status,
    headers: mime ? { 'content-type': mime } : {},
    async text() {
      return JSON.stringify(body)
    },
    async json<T>() {
      return body as T
    },
    async arrayBuffer() {
      return new Uint8Array([1, 2, 3]).buffer as ArrayBuffer
    },
  }
}

const request: ImageRunRequest = {
  kind: 'image',
  channelId: 'c',
  model: 'gemini-3-pro-image',
  prompt: 'a cat',
  inputs: [],
  params: { count: 1 },
}

function coreWith(handler: (req: NetworkRequest) => Promise<NetworkResponse>) {
  const core = createOpenAiImagesCore(cfg, {
    network: createMemoryNetwork({ handler }),
    assets: createMemoryPlatform().assets,
  })
  return { core, assets: createGeneratedAssetFactory(core) }
}

describe('openaiImages / protocol adapter modules', () => {
  it('downloads a chat markdown image and infers its MIME from the URL', async () => {
    const { core, assets } = coreWith(async (req) => {
      if (req.url.endsWith('/chat/completions')) {
        return response(200, {
          choices: [{ message: { content: '![image](https://files.test/a.jpg)' } }],
        })
      }
      return response(200, {}, 'image/jpeg')
    })
    const result = await generateChatImage(core, assets, request, signal)
    expect(result[0]!.mime).toBe('image/jpeg')
    expect(result[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('returns null for an unsupported Gemini native path so chat fallback can run', async () => {
    const { core, assets } = coreWith(async () =>
      response(503, { error: { message: '不支持此 API 路径' } }),
    )
    const spec = imageParamsFor('gemini-3-pro-image')!
    await expect(
      generateGeminiNativeImage(core, assets, request, spec, signal),
    ).resolves.toBeNull()
  })
})
