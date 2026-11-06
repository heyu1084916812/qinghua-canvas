import { describe, expect, it } from 'vitest'
import {
  isPinterestLoopbackRedirect,
  parsePinterestCallbackInput,
} from './pinterestOAuth'

describe('Pinterest OAuth callback input', () => {
  it('only enables the local listener for an HTTP loopback redirect', () => {
    expect(
      isPinterestLoopbackRedirect('http://127.0.0.1:53682/pinterest/callback'),
    ).toBe(true)
    expect(
      isPinterestLoopbackRedirect('http://localhost:53682/pinterest/callback'),
    ).toBe(true)
    expect(
      isPinterestLoopbackRedirect('https://example.com/pinterest/callback'),
    ).toBe(false)
    expect(
      isPinterestLoopbackRedirect('https://localhost/pinterest/callback'),
    ).toBe(false)
  })

  it('extracts the code and validates state', () => {
    expect(
      parsePinterestCallbackInput(
        'http://127.0.0.1:53682/pinterest/callback?code=a%2Fb&state=s1',
        's1',
      ),
    ).toEqual({ code: 'a/b', state: 's1' })
  })

  it('surfaces provider errors and rejects missing or untrusted callback state', () => {
    expect(() =>
      parsePinterestCallbackInput(
        'http://127.0.0.1:53682/pinterest/callback?error=access_denied',
        's1',
      ),
    ).toThrow('access_denied')
    expect(() =>
      parsePinterestCallbackInput(
        'http://127.0.0.1:53682/pinterest/callback?state=s1',
        's1',
      ),
    ).toThrow('缺少 code')
    expect(() =>
      parsePinterestCallbackInput(
        'http://127.0.0.1:53682/pinterest/callback?code=x&state=s2',
        's1',
      ),
    ).toThrow('state 不匹配')
    expect(() =>
      parsePinterestCallbackInput(
        'http://127.0.0.1:53682/pinterest/callback?code=x',
        's1',
      ),
    ).toThrow('缺少 state')
    expect(() =>
      parsePinterestCallbackInput(
        'http://127.0.0.1:53682/pinterest/callback?code=x&state=s1',
        '',
      ),
    ).toThrow('请先开始')
  })
})
