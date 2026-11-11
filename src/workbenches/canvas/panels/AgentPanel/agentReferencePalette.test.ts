import { describe, expect, it, vi } from 'vitest'
import { decodeImageToRgba, sampleImagePalette } from './agentReferencePalette'

describe('sampleImagePalette（C3）', () => {
  it('用注入的解码结果算主色', async () => {
    const decode = vi.fn(async () => new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255]))
    expect(await sampleImagePalette(new Uint8Array([1]), 'image/png', decode)).toEqual([
      { hex: '#0A141E', share: 1 },
    ])
    expect(decode).toHaveBeenCalledWith(new Uint8Array([1]), 'image/png')
  })

  it('解码失败 / 不支持 / 全透明 → null，不抛错', async () => {
    expect(await sampleImagePalette(new Uint8Array(), 'image/png', async () => { throw new Error('bad') })).toBeNull()
    expect(await sampleImagePalette(new Uint8Array(), 'image/png', async () => null)).toBeNull()
    expect(await sampleImagePalette(new Uint8Array(), 'image/png', async () => new Uint8Array([0, 0, 0, 0]))).toBeNull()
  })

  it('没有 createImageBitmap / OffscreenCanvas 的环境（node）直接返回 null', async () => {
    if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') return
    expect(await decodeImageToRgba(new Uint8Array([1]), 'image/png')).toBeNull()
  })
})
