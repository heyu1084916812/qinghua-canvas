import { describe, expect, it } from 'vitest'
import { createMemoryNetwork, createMemoryPlatform } from '../../memory'
import type { ResolvedChannelConfig } from '../registry'
import { createOpenAiImagesAdapterFromCore, createOpenAiImagesCore } from './createAdapter'

const cfg: ResolvedChannelConfig = {
  id: 'c',
  protocol: 'openai-images',
  baseUrl: 'https://x',
  credentialRef: null,
  modelCache: [],
  apiKey: 'k',
}

describe('openaiImages / adapter composition module', () => {
  it('exposes five stable ChannelAdapter methods with the public protocol', () => {
    const core = createOpenAiImagesCore(cfg, {
      network: createMemoryNetwork(),
      assets: createMemoryPlatform().assets,
    })
    const adapter = createOpenAiImagesAdapterFromCore(core)
    expect(Object.keys(adapter)).toEqual([
      'protocol',
      'verify',
      'listModels',
      'generateImage',
      'generateVideo',
      'completeText',
    ])
    expect(adapter.protocol).toBe('openai-images')
  })
})
