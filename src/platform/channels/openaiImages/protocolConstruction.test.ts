import { describe, expect, it } from 'vitest'
import { createMemoryNetwork, createMemoryPlatform } from '../../memory'
import type { ResolvedChannelConfig } from '../registry'
import type { ImageRunRequest } from '../types'
import { createOpenAiImagesCore } from './createAdapter'
import { generateImage } from './generateImage'
import {
  geminiNativeRequestShape,
  postGenerations,
  prepareImageRequest,
  readImageFiles,
  toDataUris,
  toInlineImages,
} from './requestConstruction'
import {
  generateSoonStudioImage,
  soonStudioSubmitRequest,
} from './soonStudioPolling'
import { unsupportedGeminiNativePath } from './geminiImageProtocol'
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

const request = (
  inputs: ImageRunRequest['inputs'] = [],
  overrides: Partial<ImageRunRequest> = {},
): ImageRunRequest => ({
  kind: 'image',
  channelId: 'c',
  model: 'gpt-image-2',
  prompt: 'a cat',
  inputs,
  params: { count: 1 },
  ...overrides,
})

function deps(rows: { id: string; bytes: Uint8Array; mime: string }[] = []) {
  const platform = createMemoryPlatform({ rows: { assets: rows } })
  return {
    network: createMemoryNetwork({ handler: async () => ({}) as never }),
    assets: platform.assets,
  }
}

function json(status: number, body: unknown) {
  return {
    status,
    headers: {},
    async text() {
      return JSON.stringify(body)
    },
    async json<T>() {
      return body as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

describe('openaiImages / request construction module', () => {
  it('builds the OpenAI JSON request and preserves size, quality and background', async () => {
    const calls: unknown[] = []
    const core = createOpenAiImagesCore(cfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          calls.push(req.body)
          return json(200, {})
        },
      }),
      assets: deps().assets,
    })
    await postGenerations(
      core,
      request([], { prompt: 'garden' }),
      2,
      '1024x1024',
      'high',
      'transparent',
      signal,
    )
    expect(calls[0]).toEqual({
      model: 'gpt-image-2',
      prompt: 'garden',
      n: 2,
      size: '1024x1024',
      quality: 'high',
      background: 'transparent',
      response_format: 'b64_json',
    })
  })

  it('prepares distinct image files, Data URIs and Gemini inline images', async () => {
    const rows = [
      { id: 'ref1', bytes: new Uint8Array([1, 2]), mime: 'image/png' },
      { id: 'ref2', bytes: new Uint8Array([3, 4]), mime: 'image/jpeg' },
    ]
    const core = createOpenAiImagesCore(cfg, deps(rows))
    const imageRequest = request([
      { kind: 'asset', nodeId: 'n1', assetHash: 'ref1', mime: 'image/png' },
      { kind: 'asset', nodeId: 'n2', assetHash: 'ref2', mime: 'image/jpeg' },
    ])
    expect(await readImageFiles(core, imageRequest)).toHaveLength(2)
    expect(await toDataUris(core, imageRequest)).toHaveLength(2)
    expect(await toInlineImages(core, imageRequest)).toEqual([
      { mimeType: 'image/png', data: 'AQI=' },
      { mimeType: 'image/jpeg', data: 'AwQ=' },
    ])
  })

  it('builds Gemini native imageConfig with every input image as an inline part', () => {
    const spec = imageParamsFor('gemini-3-pro-image')!
    const shape = geminiNativeRequestShape(
      { base: 'https://x/v1', config: cfg },
      request([], {
        model: 'gemini-3-pro-image',
        params: { count: 1, ratio: '21:9', resolution: '2K' },
      }),
      spec,
      [{ mimeType: 'image/png', data: 'AQI=' }],
    )
    expect(shape.url).toBe('https://x/v1beta/models/gemini-3-pro-image:generateContent')
    expect(shape.body).toMatchObject({
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '21:9', imageSize: '2K' },
      },
      contents: [
        {
          parts: [
            { text: 'a cat' },
            { inlineData: { mimeType: 'image/png', data: 'AQI=' } },
          ],
        },
      ],
    })
    expect(unsupportedGeminiNativePath('不支持此 API 路径', 503)).toBe(true)
    expect(unsupportedGeminiNativePath('busy', 500)).toBe(false)
  })

  it('chooses spec requests and sends the count-capped size through the adapter module', async () => {
    const calls: { url: string; body: unknown }[] = []
    const core = createOpenAiImagesCore(cfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          calls.push({ url: req.url, body: req.body })
          return json(200, { data: [{ b64_json: btoa('x') }] })
        },
      }),
      assets: deps().assets,
    })
    const prepared = await prepareImageRequest(core, request(), true)
    expect(prepared.openAiStyle).toBe(true)
    expect(prepared.count).toBe(1)
    const { createGeneratedAssetFactory } = await import('./generatedAssets')
    const assets = await generateImage(
      core,
      createGeneratedAssetFactory(core),
      request(),
      signal,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://x/v1/images/generations')
    expect(assets).toHaveLength(1)
  })
})

describe('openaiImages / async task module', () => {
  it('builds a single POST with respond-async and does not resend it after poll timeout', async () => {
    const core = createOpenAiImagesCore(
      { ...cfg, protocol: 'soonstudio' },
      deps(),
      {
        soonStudioPollIntervalMs: 0,
        soonStudioPollTimeoutMs: 0,
        soonStudioMaxPolls: 2,
        sleep: async () => {},
      },
    )
    const input = {
      request: request(),
      count: 1,
      size: '1024x1024',
      quality: null,
      background: null,
      spec: null,
      files: [],
    }
    const submission = soonStudioSubmitRequest(core, input)
    expect(submission.request.url).toBe('https://x/v1/images/generations?async=true')
    expect(submission.request.headers.Prefer).toBe('respond-async')
    const posts: string[] = []
    const pollCore = createOpenAiImagesCore(
      { ...cfg, protocol: 'soonstudio' },
      {
        network: createMemoryNetwork({
          handler: async (req) => {
            if (req.method === 'POST') {
              posts.push(req.url)
              return json(200, { task_id: 'task_timeout' })
            }
            return json(200, { data: { status: 'IN_PROGRESS' } })
          },
        }),
        assets: deps().assets,
      },
      {
        soonStudioPollIntervalMs: 0,
        soonStudioPollTimeoutMs: 0,
        soonStudioMaxPolls: 2,
        sleep: async () => {},
      },
    )
    const { createGeneratedAssetFactory } = await import('./generatedAssets')
    await expect(
      generateSoonStudioImage(
        pollCore,
        createGeneratedAssetFactory(pollCore),
        { nativeGeminiFallback: async () => null },
        input,
        signal,
      ),
    ).rejects.toMatchObject({ appError: { kind: 'execution', detail: 'accepted' } })
    expect(posts).toHaveLength(1)
  })
})
