import { describe, expect, it } from 'vitest'
import {
  pinterestBasicAuth,
  pinterestJsonPayload,
  pinterestResponseError,
} from './pinterestHttp'

describe('pinterestHttp', () => {
  it('encodes Basic auth and preserves upstream error details', () => {
    expect(pinterestBasicAuth('id', 'secret')).toBe('aWQ6c2VjcmV0')
    expect(pinterestResponseError({ message: 'scope missing' }, 'HTTP 403')).toBe(
      'HTTP 403: scope missing',
    )
  })

  it('rejects malformed success payloads without inventing data', async () => {
    await expect(
      pinterestJsonPayload(200, async () => 'not json'),
    ).rejects.toThrow('无法解析的响应')
  })
})
