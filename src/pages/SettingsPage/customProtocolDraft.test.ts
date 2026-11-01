import { describe, expect, it } from 'vitest'
import {
  customProtocolIdForName,
  customProtocolShortForName,
  protocolVersionForBaseUrl,
} from './customProtocolDraft'

describe('customProtocolDraft', () => {
  it('生成稳定的短标签和内部协议标识', () => {
    expect(customProtocolShortForName('我的中转站')).toBe('我的中转站')
    expect(customProtocolShortForName('A very long relay name')).toBe('Averylon')
    expect(customProtocolIdForName('My Relay', [])).toBe('my-relay')
    expect(customProtocolIdForName('我的中转站', [])).toMatch(/^custom-[a-z0-9]+$/)
  })

  it('同名协议自动追加序号，不覆盖已有协议', () => {
    expect(customProtocolIdForName('My Relay', ['my-relay', 'my-relay-2'])).toBe(
      'my-relay-3',
    )
  })

  it('从渠道地址识别版本段，无法识别时回退 /v1', () => {
    expect(protocolVersionForBaseUrl('https://api.example.com/v1')).toBe('/v1')
    expect(protocolVersionForBaseUrl('https://ark.example.com/api/v3/')).toBe('/api/v3')
    expect(protocolVersionForBaseUrl('not-a-url')).toBe('/v1')
  })
})
