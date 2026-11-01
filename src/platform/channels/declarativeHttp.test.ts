import { describe, expect, it } from 'vitest'
import type { DeclarativeProtocolRecipe } from '../../domain/project/protocolRecipe'
import { createMemoryNetwork, createMemoryPlatform } from '../../platform/memory'
import { createDeclarativeHttpAdapter, extractJsonPath } from './declarativeHttp'
import { bytesToBase64 } from './base64'
import { solidPng } from './mockPng'
import type { ImageRunRequest, TextRunRequest } from './types'

function resp(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers,
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

function binaryResp(status: number, bytes: Uint8Array, headers: Record<string, string> = {}) {
  return {
    status,
    headers,
    async text() {
      return ''
    },
    async json<T>(): Promise<T> {
      throw new Error('not JSON')
    },
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer
    },
  }
}

const signal = new AbortController().signal
const cfg = {
  id: 'c',
  protocol: 'imported',
  baseUrl: 'https://api.example.com/v1',
  credentialRef: null,
  modelCache: [],
  apiKey: 'secret',
}

const baseRecipe: DeclarativeProtocolRecipe = {
  version: 1,
  auth: { type: 'bearer', header: 'Authorization' },
  models: {
    request: { method: 'GET', path: '/models' },
    items: '$.data[*]',
    id: '$.id',
    categoryPath: '$.type',
    categoryMap: { chat: 'chat', picture: 'image' },
  },
  chat: {
    request: {
      method: 'POST',
      path: '/chat/completions',
      body: {
        model: '{{model}}',
        messages: { $var: 'messages' },
        tools: { $var: 'tools' },
      },
    },
    response: {
      text: '$.choices[0].message.content',
      reasoning: '$.choices[0].message.reasoning_content',
      finishReason: '$.choices[0].finish_reason',
      toolCalls: '$.choices[0].message.tool_calls[*]',
    },
  },
}

describe('declarativeHttp adapter', () => {
  it('extracts simplified JSONPath arrays and keeps model categories', async () => {
    expect(extractJsonPath({ data: [{ id: 'a' }, { id: 'b' }] }, '$.data[*].id')).toEqual([
      'a',
      'b',
    ])
    const adapter = createDeclarativeHttpAdapter(
      { ...cfg, recipe: baseRecipe },
      {
        network: createMemoryNetwork({
          handler: async (request) => {
            expect(request.url).toBe('https://api.example.com/v1/models')
            expect(request.headers?.Authorization).toBe('Bearer secret')
            return resp(200, {
              data: [
                { id: 'chat-model', type: 'chat' },
                { id: 'image-model', type: 'picture' },
              ],
            })
          },
        }),
        assets: createMemoryPlatform().assets,
      },
    )
    const result = await adapter.verify(cfg, signal)
    expect(result).toMatchObject({
      ok: true,
      models: [
        { id: 'chat-model', category: 'chat' },
        { id: 'image-model', category: 'image' },
      ],
    })
  })

  it('runs a non-streaming chat and parses public reasoning and tool calls', async () => {
    const calls: { url: string; body: string }[] = []
    const adapter = createDeclarativeHttpAdapter(
      { ...cfg, recipe: baseRecipe },
      {
        network: createMemoryNetwork({
          handler: async (request) => {
            calls.push({ url: request.url, body: String(request.body ?? '') })
            return resp(200, {
              choices: [
                {
                  message: {
                    content: '我会先检查画布',
                    reasoning_content: '先读取节点',
                    tool_calls: [
                      {
                        id: 'call_1',
                        function: { name: 'readGraph', arguments: '{"scope":"all"}' },
                      },
                    ],
                  },
                  finish_reason: 'tool_calls',
                },
              ],
            })
          },
        }),
        assets: createMemoryPlatform().assets,
      },
    )
    const request: TextRunRequest = {
      kind: 'text',
      channelId: 'c',
      model: 'chat-model',
      prompt: '检查画布',
      messages: [{ role: 'user', content: '检查画布' }],
      tools: [{ name: 'readGraph', parameters: { type: 'object' } }],
      inputs: [],
      params: {},
    }
    const result = await adapter.completeText(request, signal)
    expect(calls[0]?.url).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(calls[0]!.body)).toMatchObject({
      model: 'chat-model',
      messages: [{ role: 'user', content: '检查画布' }],
      tools: [{ name: 'readGraph' }],
    })
    expect(result).toEqual({
      text: '我会先检查画布',
      reasoning: '先读取节点',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'call_1',
          name: 'readGraph',
          args: '{"scope":"all"}',
        },
      ],
    })
  })

  it('downloads synchronous image results and preserves requested count', async () => {
    const image = solidPng(4, 3, [1, 2, 3])
    const recipe: DeclarativeProtocolRecipe = {
      ...baseRecipe,
      image: {
        request: {
          method: 'POST',
          path: '/images/generations',
          body: {
            model: '{{model}}',
            prompt: '{{prompt}}',
            n: '{{count}}',
          },
        },
        result: ['$.data[*].url'],
      },
    }
    const calls: string[] = []
    const adapter = createDeclarativeHttpAdapter(
      { ...cfg, recipe },
      {
        network: createMemoryNetwork({
          handler: async (request) => {
            calls.push(request.url)
            if (request.url.endsWith('/images/generations')) {
              expect(JSON.parse(String(request.body))).toMatchObject({
                model: 'image-model',
                prompt: '一只猫',
                n: 2,
              })
              return resp(200, { data: [{ url: 'https://cdn.example.com/cat.png' }] })
            }
            if (request.url === 'https://cdn.example.com/cat.png') {
              return binaryResp(200, image, { 'content-type': 'image/png' })
            }
            return resp(404, {})
          },
        }),
        assets: createMemoryPlatform().assets,
      },
    )
    const request: ImageRunRequest = {
      kind: 'image',
      channelId: 'c',
      model: 'image-model',
      prompt: '一只猫',
      inputs: [],
      params: { count: 2 },
    }
    const assets = await adapter.generateImage(request, signal)
    expect(calls).toEqual([
      'https://api.example.com/v1/images/generations',
      'https://cdn.example.com/cat.png',
    ])
    expect(assets[0]).toMatchObject({ mime: 'image/png', width: 4, height: 3 })
  })

  it('submits an asynchronous task once and polls until completed', async () => {
    let polls = 0
    let posts = 0
    const output = solidPng(2, 2, [9, 8, 7])
    const recipe: DeclarativeProtocolRecipe = {
      ...baseRecipe,
      image: {
        request: {
          method: 'POST',
          path: '/images/jobs',
          body: { model: '{{model}}', prompt: '{{prompt}}' },
        },
        task: {
          id: '$.job.id',
          poll: { method: 'GET', path: '/images/jobs/{{taskId}}' },
          status: '$.job.status',
          success: ['DONE'],
          failure: ['FAILED'],
          result: ['$.job.outputs[*].url'],
          intervalMs: 1,
          maxPolls: 5,
          timeoutMs: 10_000,
        },
      },
    }
    const adapter = createDeclarativeHttpAdapter(
      { ...cfg, recipe },
      {
        network: createMemoryNetwork({
          handler: async (request) => {
            if (request.url.endsWith('/images/jobs')) {
              posts += 1
              return resp(202, { job: { id: 'job_1' } })
            }
            if (request.url.endsWith('/images/jobs/job_1')) {
              polls += 1
              if (polls === 1) return resp(200, { job: { status: 'RUNNING' } })
              return resp(200, {
                job: {
                  status: 'DONE',
                  outputs: [
                    { url: `data:image/png;base64,${bytesToBase64(output)}` },
                  ],
                },
              })
            }
            return resp(404, {})
          },
        }),
        assets: createMemoryPlatform().assets,
      },
      {
        sleep: async () => {},
      },
    )
    const assets = await adapter.generateImage(
      {
        kind: 'image',
        channelId: 'c',
        model: 'image-model',
        prompt: '任务图',
        inputs: [],
        params: {},
      },
      signal,
    )
    expect(posts).toBe(1)
    expect(polls).toBe(2)
    expect(assets).toHaveLength(1)
  })

  it('builds multipart requests when the API requires file uploads', async () => {
    const reference = solidPng(3, 2, [4, 5, 6])
    const recipe: DeclarativeProtocolRecipe = {
      ...baseRecipe,
      image: {
        request: {
          method: 'POST',
          path: '/images/edits',
          contentType: 'multipart',
          body: {
            model: '{{model}}',
            prompt: '{{prompt}}',
            image: { $var: 'images' },
          },
        },
        result: ['$.data[*].url'],
      },
    }
    let seen: FormData | null = null
    const adapter = createDeclarativeHttpAdapter(
      { ...cfg, recipe },
      {
        network: createMemoryNetwork({
          handler: async (request) => {
            seen = request.body as FormData
            return resp(200, {
              data: [{ url: `data:image/png;base64,${bytesToBase64(reference)}` }],
            })
          },
        }),
        assets: createMemoryPlatform({
          rows: {
            assets: [{ id: 'ref', bytes: reference, mime: 'image/png' }],
          },
        }).assets,
      },
    )
    const assets = await adapter.generateImage(
      {
        kind: 'image',
        channelId: 'c',
        model: 'image-model',
        prompt: '改图',
        inputs: [{ kind: 'asset', nodeId: 'n', assetHash: 'ref', mime: 'image/png' }],
        params: {},
      },
      signal,
    )
    expect(seen).toBeInstanceOf(FormData)
    expect(seen!.get('model')).toBe('image-model')
    expect(seen!.getAll('image')).toHaveLength(1)
    expect(assets).toHaveLength(1)
  })
})
