import { describe, expect, it } from 'vitest'
import { isPublicHttpUrl } from './publicUrl'

describe('isPublicHttpUrl', () => {
  it('accepts public HTTP(S) hosts', () => {
    expect(isPublicHttpUrl('https://www.pinterest.com/pin/42/')).toBe(true)
    expect(isPublicHttpUrl('https://fcbarcelona.com/design')).toBe(true)
  })

  it('rejects local, private, mapped, and non-http destinations', () => {
    expect(isPublicHttpUrl('http://localhost:18765/state')).toBe(false)
    expect(isPublicHttpUrl('http://localhost./state')).toBe(false)
    expect(isPublicHttpUrl('http://127.0.0.1/private')).toBe(false)
    expect(isPublicHttpUrl('http://2130706433/private')).toBe(false)
    expect(isPublicHttpUrl('http://192.168.1.20/file')).toBe(false)
    expect(isPublicHttpUrl('http://100.64.0.1/file')).toBe(false)
    expect(isPublicHttpUrl('http://198.18.0.1/file')).toBe(false)
    expect(isPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isPublicHttpUrl('http://metadata.google.internal/computeMetadata')).toBe(false)
    expect(isPublicHttpUrl('http://[::ffff:7f00:1]/private')).toBe(false)
    expect(isPublicHttpUrl('http://[2001:db8::1]/private')).toBe(false)
    expect(isPublicHttpUrl('file:///C:/secret.txt')).toBe(false)
  })
})
