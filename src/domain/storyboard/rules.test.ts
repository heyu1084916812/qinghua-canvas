import { describe, expect, it } from 'vitest'
import { emptyStoryboard } from './model'
import { assetListOf, pairKey } from './rules'

describe('storyboard · 纯规则', () => {
  it('资产对键与顺序无关，资产列表只按类别选择，不复制状态', () => {
    const doc = {
      ...emptyStoryboard('p1'),
      characters: [{ id: 'c1', name: '甲', description: '', aliases: [] }],
      scenes: [{ id: 's1', name: '场景', description: '', aliases: [] }],
    }
    expect(pairKey('z', 'a')).toBe('a|z')
    expect(assetListOf(doc, 'char')).toBe(doc.characters)
    expect(assetListOf(doc, 'scene')).toBe(doc.scenes)
  })
})
