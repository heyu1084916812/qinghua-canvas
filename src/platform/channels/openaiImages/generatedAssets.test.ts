import { describe, expect, it } from 'vitest'
import { createMemoryNetwork, createMemoryPlatform } from '../../memory'
import type { NetworkResponse } from '../../ports'
import type { ResolvedChannelConfig } from '../registry'
import { createGeneratedAssetFactory } from './generatedAssets'

const cfg: ResolvedChannelConfig = {
  id: 'c',
  protocol: 'openai-images',
  baseUrl: 'https://x',
  credentialRef: null,
  modelCache: [],
  apiKey: 'k',
}

function response(status: number, body: unknown): NetworkResponse {
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

const signal = new AbortController().signal

describe('openaiImages / generated asset writer', () => {
  it('downloads only same-origin assets with credentials and falls back to Base64', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const headers: string[] = []
    const factory = createGeneratedAssetFactory({
      config: cfg,
      base: 'https://x/v1',
      deps: {
        network: createMemoryNetwork({
          handler: async (req) => {
            headers.push(String(req.headers?.Authorization ?? ''))
            if (req.url === 'https://x/result.png') {
              throw { kind: 'network', detail: 'timeout' }
            }
            return {
              status: 200,
              headers: { 'content-type': 'image/webp' },
              async text() {
                return ''
              },
              async json<T>() {
                return {} as T
              },
              async arrayBuffer() {
                return bytes.buffer.slice(0) as ArrayBuffer
              },
            }
          },
        }),
        assets: createMemoryPlatform().assets,
      },
    })
    const assets = await factory.assetsFromItems(
      [
        {
          url: 'https://x/result.png',
          fallbackUrls: ['https://cdn.example/result.png'],
          fallbackB64: btoa('fallback'),
        },
      ],
      { width: 1024, height: 1024 },
      signal,
    )
    expect(headers).toEqual(['Bearer k', ''])
    expect(assets[0]!.mime).toBe('image/webp')
    expect(assets[0]!.bytes).toEqual(bytes)
    expect(assets[0]!.requestedWidth).toBe(1024)
  })

  it('rejects a 200 response that is not an image list', async () => {
    const factory = createGeneratedAssetFactory({
      config: cfg,
      base: 'https://x/v1',
      deps: {
        network: createMemoryNetwork(),
        assets: createMemoryPlatform().assets,
      },
    })
    await expect(
      factory.toAssets(
        response(200, { code: 451, message: 'region blocked' }),
        {},
        signal,
      ),
    ).rejects.toMatchObject({
      appError: { kind: 'parse', raw: expect.stringContaining('region blocked') },
    })
  })
})
