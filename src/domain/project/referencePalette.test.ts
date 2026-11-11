import { describe, expect, it } from 'vitest'
import { dominantHexColors, paletteSentence } from './referencePalette'

function pixels(rows: [number, number, number, number, number][]): Uint8Array {
  const out: number[] = []
  for (const [r, g, b, a, count] of rows) {
    for (let i = 0; i < count; i += 1) out.push(r, g, b, a)
  }
  return new Uint8Array(out)
}

describe('dominantHexColors（C3 本地主色）', () => {
  it('按占比排序输出 HEX，相近色合并，透明像素不计', () => {
    const colors = dominantHexColors(pixels([
      [31, 61, 43, 255, 60],
      [33, 63, 45, 255, 10],
      [244, 239, 230, 255, 30],
      [255, 0, 0, 0, 500],
    ]))
    expect(colors.map((c) => c.hex)).toEqual(['#1F3D2B', '#F4EFE6'])
    expect(colors[0]!.share).toBeCloseTo(0.7)
    expect(colors[1]!.share).toBeCloseTo(0.3)
  })

  it('占比太小的颜色丢弃；最多 max 个；全透明返回空', () => {
    const colors = dominantHexColors(
      pixels([[0, 0, 0, 255, 98], [255, 255, 255, 255, 2]]),
      { minShare: 0.05 },
    )
    expect(colors.map((c) => c.hex)).toEqual(['#000000'])
    const many = dominantHexColors(pixels([
      [0, 0, 0, 255, 10], [255, 0, 0, 255, 10], [0, 255, 0, 255, 10], [0, 0, 255, 255, 10],
    ]), { max: 2 })
    expect(many).toHaveLength(2)
    expect(dominantHexColors(pixels([[1, 2, 3, 0, 5]]))).toEqual([])
  })

  it('paletteSentence 写成一句带百分比的色值', () => {
    expect(paletteSentence([{ hex: '#203E2C', share: 0.7 }, { hex: '#F4EFE6', share: 0.3 }])).toBe(
      '主色（本地像素采样）：#203E2C 70%、#F4EFE6 30%',
    )
    expect(paletteSentence([])).toBe('')
  })
})
