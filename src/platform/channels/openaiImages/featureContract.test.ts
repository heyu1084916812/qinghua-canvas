import { describe, expect, it } from 'vitest'
import { createMemoryNetwork, createMemoryPlatform } from '../../memory'
import type { NetworkResponse } from '../../ports'
import type { ResolvedChannelConfig } from '../registry'
import type { ImageRunRequest } from '../types'
import * as facade from '../openaiImages'

const cfg: ResolvedChannelConfig = {
  id: 'c',
  protocol: 'openai-images',
  baseUrl: 'https://x',
  credentialRef: null,
  modelCache: [],
  apiKey: 'k',
}

const soonCfg: ResolvedChannelConfig = {
  ...cfg,
  id: 'soon',
  protocol: 'soonstudio',
  baseUrl: 'https://soon.test',
}

const signal = new AbortController().signal

function b64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function dataUri(bytes: Uint8Array): string {
  return `data:image/png;base64,${b64(bytes)}`
}

function jsonResponse(status: number, body: unknown): NetworkResponse {
  return {
    status,
    headers: {},
    async text() {
      return JSON.stringify(body)
    },
    async json<T>(): Promise<T> {
      return body as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

function bytesResponse(bytes: Uint8Array): NetworkResponse {
  return {
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
    async text() {
      return ''
    },
    async json<T>(): Promise<T> {
      return {} as T
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    },
  }
}

function request(
  inputs: ImageRunRequest['inputs'] = [],
  overrides: Partial<ImageRunRequest> = {},
): ImageRunRequest {
  return {
    kind: 'image',
    channelId: 'c',
    model: 'gpt-image-2',
    prompt: 'a cat',
    inputs,
    params: { count: 1 },
    ...overrides,
  }
}

function assetsWith(rows: { id: string; bytes: Uint8Array; mime: string }[]) {
  return createMemoryPlatform({ rows: { assets: rows } }).assets
}

describe('openaiImages public facade / split feature contract', () => {
  it('keeps every public export name on the stable facade', () => {
    for (const name of [
      'createOpenAiImagesAdapter',
      'customImageSize',
      'normalizeBaseUrl',
      'openAiImageSize',
      'openAiImageQuality',
      'specImageSize',
      'imageUrlFromChatContent',
      'findGeminiImage',
      'findInlineImage',
      'geminiNoImageReason',
    ]) {
      expect(facade).toHaveProperty(name)
    }
    expect(typeof facade.createOpenAiImagesAdapter).toBe('function')
    expect(typeof facade.customImageSize).toBe('function')
    expect(facade.normalizeBaseUrl('https://x/v1/')).toBe('https://x')
  })

  it('decodes a synchronous b64_json image list', async () => {
    const bytes = new TextEncoder().encode('sync-image')
    const adapter = facade.createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async () => jsonResponse(200, { data: [{ b64_json: b64(bytes) }] }),
      }),
      assets: assetsWith([]),
    })
    const assets = await adapter.generateImage(request(), signal)
    expect(assets).toHaveLength(1)
    expect(assets[0]!.bytes).toEqual(bytes)
    expect(assets[0]!.mime).toBe('image/png')
  })

  it('follows a completed async wrapper to its inner result task', async () => {
    const bytes = new Uint8Array([7, 8, 9])
    const calls: string[] = []
    const adapter = facade.createOpenAiImagesAdapter(
      soonCfg,
      {
        network: createMemoryNetwork({
          handler: async (req) => {
            calls.push(req.url)
            if (req.method === 'POST') return jsonResponse(200, { task_id: 'outer_task' })
            if (req.url.endsWith('/tasks/outer_task')) {
              return jsonResponse(200, {
                status: 'COMPLETED',
                response: { body: { task_id: 'inner_result' } },
              })
            }
            return jsonResponse(200, {
              data: { status: 'SUCCESS', data: { url: [dataUri(bytes)] } },
            })
          },
        }),
        assets: assetsWith([]),
      },
      { soonStudioPollIntervalMs: 0, sleep: async () => {} },
    )
    const assets = await adapter.generateImage(request(), signal)
    expect(calls).toEqual([
      'https://soon.test/v1/images/generations?async=true',
      'https://soon.test/v1/images/tasks/outer_task',
      'https://soon.test/v1/images/tasks/inner_result',
    ])
    expect(assets[0]!.bytes).toEqual(bytes)
  })

  it('preserves a nested upstream error instead of reporting accepted', async () => {
    const adapter = facade.createOpenAiImagesAdapter(
      soonCfg,
      {
        network: createMemoryNetwork({
          handler: async (req) =>
            req.method === 'POST'
              ? jsonResponse(200, { task_id: 'outer_error' })
              : jsonResponse(200, {
                  status: 'completed',
                  response: {
                    status: 400,
                    body: {
                      error: { code: 'model_not_allowed', message: 'not enabled' },
                    },
                  },
                }),
        }),
        assets: assetsWith([]),
      },
      { soonStudioPollIntervalMs: 0, sleep: async () => {} },
    )
    await expect(adapter.generateImage(request(), signal)).rejects.toMatchObject({
      appError: {
        kind: 'http',
        status: 400,
        verbatim: true,
        body: expect.stringContaining('model_not_allowed'),
      },
    })
  })

  it('rejects a 200 response that is not an image list', async () => {
    const adapter = facade.createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async () => jsonResponse(200, { code: 451, message: 'region blocked' }),
      }),
      assets: assetsWith([]),
    })
    await expect(adapter.generateImage(request(), signal)).rejects.toMatchObject({
      appError: { kind: 'parse', raw: expect.stringContaining('region blocked') },
    })
  })

  it('reports missing Key before a paid image request', async () => {
    let calls = 0
    const adapter = facade.createOpenAiImagesAdapter(
      { ...cfg, apiKey: null },
      {
        network: createMemoryNetwork({
          handler: async () => {
            calls += 1
            return jsonResponse(401, {})
          },
        }),
        assets: assetsWith([]),
      },
    )
    const result = await adapter.verify(cfg, signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({ kind: 'channel', detail: 'missingKey' })
    }
    expect(calls).toBe(1)
  })

  it('does not resubmit a paid POST after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    let posts = 0
    const adapter = facade.createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          if (req.method === 'POST') posts += 1
          throw { kind: 'network', detail: 'aborted', sendPhase: 'unknown' }
        },
      }),
      assets: assetsWith([]),
    })
    await expect(
      adapter.generateImage(request(), controller.signal),
    ).rejects.toMatchObject({ kind: 'network', detail: 'aborted' })
    expect(posts).toBe(1)
  })

  it('does not resubmit a paid POST when async polling times out', async () => {
    let posts = 0
    const adapter = facade.createOpenAiImagesAdapter(
      soonCfg,
      {
        network: createMemoryNetwork({
          handler: async (req) => {
            if (req.method === 'POST') {
              posts += 1
              return jsonResponse(200, { task_id: 'timeout_task' })
            }
            return jsonResponse(200, { data: { status: 'IN_PROGRESS' } })
          },
        }),
        assets: assetsWith([]),
      },
      {
        soonStudioPollIntervalMs: 0,
        soonStudioPollTimeoutMs: 0,
        soonStudioMaxPolls: 3,
        sleep: async () => {},
      },
    )
    await expect(adapter.generateImage(request(), signal)).rejects.toMatchObject({
      appError: { kind: 'execution', detail: 'accepted' },
    })
    expect(posts).toBe(1)
  })

  it('falls back from an unsupported Gemini native endpoint to chat image output', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const calls: string[] = []
    const adapter = facade.createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          calls.push(req.url)
          if (req.url.includes('/v1beta/')) {
            return jsonResponse(503, { error: { message: '不支持此 API 路径' } })
          }
          if (req.url.endsWith('/chat/completions')) {
            return jsonResponse(200, {
              choices: [{ message: { content: '![image](https://files.example/a.jpg)' } }],
            })
          }
          return bytesResponse(bytes)
        },
      }),
      assets: assetsWith([]),
    })
    const assets = await adapter.generateImage(
      request([], { model: 'gemini-3-pro-image' }),
      signal,
    )
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('/v1beta/models/gemini-3-pro-image:generateContent')
    expect(calls[1]).toBe('https://x/v1/chat/completions')
    expect(calls[2]).toBe('https://files.example/a.jpg')
    expect(assets[0]!.mime).toBe('image/jpeg')
    expect(assets[0]!.bytes).toEqual(bytes)
  })

  it('uploads every distinct image input through multipart edits', async () => {
    const calls: { url: string; body: unknown }[] = []
    const adapter = facade.createOpenAiImagesAdapter(cfg, {
      network: createMemoryNetwork({
        handler: async (req) => {
          calls.push({ url: req.url, body: req.body })
          return jsonResponse(200, { data: [{ b64_json: b64(new Uint8Array([1])) }] })
        },
      }),
      assets: assetsWith([
        { id: 'ref1', bytes: new Uint8Array([1, 2]), mime: 'image/png' },
        { id: 'ref2', bytes: new Uint8Array([3, 4]), mime: 'image/jpeg' },
      ]),
    })
    await adapter.generateImage(
      request([
        { kind: 'asset', nodeId: 'n1', assetHash: 'ref1', mime: 'image/png' },
        { kind: 'asset', nodeId: 'n2', assetHash: 'ref2', mime: 'image/jpeg' },
      ]),
      signal,
    )
    expect(calls[0]!.url).toBe('https://x/v1/images/edits')
    expect((calls[0]!.body as FormData).getAll('image')).toHaveLength(2)
  })
})
