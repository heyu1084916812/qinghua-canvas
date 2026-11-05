import { describe, expect, it } from 'vitest'
import {
  CHANNEL_FILTER_OPTIONS,
  GLOBAL_MODEL_VENDORS,
  MAP_FILTERS,
  PROTOCOL_GROUPS,
  channelInitial,
  channelMonogramTone,
} from './settingsPageConstants'

describe('设置页静态目录与头像规则', () => {
  it('保留筛选、模型厂商和协议分组的固定顺序', () => {
    expect(MAP_FILTERS.map((item) => item.key)).toEqual(['image', 'chat', 'video', 'audio'])
    expect(CHANNEL_FILTER_OPTIONS.map((item) => item.value)).toEqual(['all', 'enabled', 'disabled'])
    expect(GLOBAL_MODEL_VENDORS[0]).toEqual({ value: 'openai', label: 'OpenAI' })
    expect(PROTOCOL_GROUPS.map((item) => item.kind)).toEqual(['offline', 'station', 'public', 'legacy', 'custom'])
  })

  it('渠道头像首字与色调结果稳定', () => {
    expect(channelInitial(' 轻画 ')).toBe('轻')
    expect(channelInitial('')).toBe('?')
    expect(channelMonogramTone('同一名称')).toBe(channelMonogramTone('同一名称'))
    expect(channelMonogramTone('同一名称')).toBeLessThan(6)
  })
})
