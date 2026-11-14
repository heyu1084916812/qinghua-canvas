import { describe, expect, it } from 'vitest'
import type { Channel } from '../../domain/project/channel'
import { buildProtocolCatalog } from '../../domain/project/protocol'
import { createMemoryPlatform } from '../../platform/memory'
import { quickTestCategory, runChannelQuickTest } from './channelQuickTest'

/**
 * 渠道「快速测试」（#1117）：只做三件事 —— 认类别、挑对适配器方法、如实回结果。
 * 走 `mock` 协议的真适配器（不是替身），所以「调错方法」会在这里立刻露出来。
 */

const channel = {
  id: 'ch-mock',
  name: 'Mock',
  icon: null,
  protocol: 'mock',
  baseUrl: 'https://mock.local',
  models: [],
  credentialGroups: [],
  enabled: true,
} as unknown as Channel

const base = {
  platform: createMemoryPlatform(),
  channel,
  catalog: buildProtocolCatalog([]),
  apiKey: 'k',
  model: 'mock-image',
  prompt: '一只橘猫',
}

describe('渠道快速测试', () => {
  it('类别只认图片 / 视频 / 对话，其它一律交给调用方给提示', () => {
    expect(quickTestCategory('image')).toBe('image')
    expect(quickTestCategory('video')).toBe('video')
    expect(quickTestCategory('chat')).toBe('chat')
    expect(quickTestCategory('speech')).toBeNull()
    expect(quickTestCategory('')).toBeNull()
  })

  it('图片：走 generateImage，回一个可显示的产物', async () => {
    const outcome = await runChannelQuickTest({
      ...base,
      category: 'image',
      signal: AbortSignal.timeout(5_000),
    })
    expect(outcome.kind).toBe('media')
    if (outcome.kind === 'media') {
      expect(outcome.mime.startsWith('image/')).toBe(true)
      expect(outcome.bytes && outcome.bytes.length > 0).toBe(true)
    }
  })

  it('对话：走 completeText，把文字原样带回来', async () => {
    const outcome = await runChannelQuickTest({
      ...base,
      model: 'mock-chat',
      category: 'chat',
      signal: AbortSignal.timeout(5_000),
    })
    expect(outcome.kind).toBe('text')
    if (outcome.kind === 'text') expect(outcome.text.length).toBeGreaterThan(0)
  })
})
