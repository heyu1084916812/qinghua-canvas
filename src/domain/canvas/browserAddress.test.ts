import { describe, expect, it } from 'vitest'
import {
  browserAddressError,
  describeBrowserAddress,
  normalizeBrowserAddress,
} from './browserAddress'

describe('normalizeBrowserAddress', () => {
  it('adds https:// to bare hosts and paths', () => {
    expect(normalizeBrowserAddress('dribbble.com')).toEqual({ ok: true, url: 'https://dribbble.com/' })
    expect(normalizeBrowserAddress('  packagingoftheworld.com/tea?q=1 ')).toEqual({
      ok: true,
      url: 'https://packagingoftheworld.com/tea?q=1',
    })
    expect(normalizeBrowserAddress('example.com:8080/x')).toEqual({ ok: true, url: 'https://example.com:8080/x' })
  })

  it('keeps explicit http and https', () => {
    expect(normalizeBrowserAddress('http://huaban.com/')).toEqual({ ok: true, url: 'http://huaban.com/' })
    expect(normalizeBrowserAddress('HTTPS://Dribbble.com/shots')).toEqual({ ok: true, url: 'https://dribbble.com/shots' })
  })

  it('does not fall back to search for non-URLs', () => {
    expect(normalizeBrowserAddress('')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeBrowserAddress('tea packaging')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeBrowserAddress('packaging')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeBrowserAddress('javascript:alert(1)')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeBrowserAddress('file:///C:/a.html')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeBrowserAddress('ftp://example.com')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects private and loopback hosts', () => {
    expect(normalizeBrowserAddress('http://127.0.0.1:1420')).toEqual({ ok: false, reason: 'private' })
    expect(normalizeBrowserAddress('192.168.1.2/admin')).toEqual({ ok: false, reason: 'private' })
    expect(normalizeBrowserAddress('https://tauri.localhost/')).toEqual({ ok: false, reason: 'private' })
  })

  it('has a message for every reason', () => {
    for (const reason of ['empty', 'invalid', 'private'] as const) {
      expect(browserAddressError(reason)).toBeTruthy()
    }
  })
})

describe('describeBrowserAddress', () => {
  it('splits host and rest, dropping www and the root slash', () => {
    expect(describeBrowserAddress('https://www.pinterest.com/')).toEqual({ host: 'pinterest.com', rest: '', secure: true })
    expect(describeBrowserAddress('http://huaban.com/search?q=tea')).toEqual({
      host: 'huaban.com',
      rest: '/search?q=tea',
      secure: false,
    })
  })

  it('returns null for empty or non-http values', () => {
    expect(describeBrowserAddress('')).toBeNull()
    expect(describeBrowserAddress('about:blank')).toBeNull()
  })
})
