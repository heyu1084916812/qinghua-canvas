import { describe, expect, it } from 'vitest'
import { imageMimeFromBytes } from './imageMime'

describe('imageMimeFromBytes', () => {
  it('recognizes supported raster and SVG signatures', () => {
    expect(imageMimeFromBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(imageMimeFromBytes(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg')
    expect(imageMimeFromBytes(new TextEncoder().encode('GIF89a'))).toBe('image/gif')
    expect(
      imageMimeFromBytes(
        Uint8Array.from([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
          0x57, 0x45, 0x42, 0x50,
        ]),
      ),
    ).toBe('image/webp')
    expect(
      imageMimeFromBytes(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toBe('image/svg+xml')
  })

  it('rejects HTML and arbitrary bytes', () => {
    expect(imageMimeFromBytes(new TextEncoder().encode('<html>not image</html>'))).toBe('')
    expect(imageMimeFromBytes(Uint8Array.from([1, 2, 3]))).toBe('')
  })
})
