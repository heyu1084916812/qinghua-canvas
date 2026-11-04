import { describe, expect, it } from 'vitest'
import { imageContextAssets } from './agentToolContextAssets'

const asset = (hash: string, mime: string) => ({ hash, mime, name: hash })

describe('imageContextAssets', () => {
  it('只留 image/*，视频 / 文档 / 空 MIME 全部丢掉', () => {
    const kept = imageContextAssets([
      asset('a', 'image/png'),
      asset('b', 'video/mp4'),
      asset('c', 'application/pdf'),
      asset('d', ''),
      asset('e', 'image/jpeg'),
    ])

    expect(kept.map((item) => item.hash)).toEqual(['a', 'e'])
  })

  it('保持原顺序与对象身份（不改写、不克隆）', () => {
    const first = asset('a', 'image/webp')
    const second = asset('b', 'image/svg+xml')

    const kept = imageContextAssets([first, second])

    expect(kept).toHaveLength(2)
    expect(kept[0]).toBe(first)
    expect(kept[1]).toBe(second)
  })

  it('undefined / null / 空数组都给空数组', () => {
    expect(imageContextAssets(undefined)).toEqual([])
    expect(imageContextAssets(null)).toEqual([])
    expect(imageContextAssets([])).toEqual([])
  })

  it('接受只读入参，返回的是普通数组', () => {
    const source: readonly { mime: string }[] = Object.freeze([
      Object.freeze({ mime: 'image/avif' }),
    ])

    const kept = imageContextAssets(source)

    expect(kept).toEqual([{ mime: 'image/avif' }])
    expect(Array.isArray(kept)).toBe(true)
  })
})
