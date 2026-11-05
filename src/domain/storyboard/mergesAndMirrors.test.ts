import { describe, expect, it } from 'vitest'
import { emptyStoryboard, type StoryboardShot } from './model'
import {
  attachShotImages,
  attachShotNodes,
  dismissMerge,
  mergeStoryboardRunResults,
  setAssetBaseHash,
  setAssetNode,
  shotsNeedingNode,
} from './mergesAndMirrors'
import { pairKey } from './rules'

const shot: StoryboardShot = {
  id: 'sh1',
  episodeId: 'ep1',
  scene: '',
  lines: [],
  durationSec: 3,
  prompt: '',
}

describe('storyboard · 运行镜像与归并规则', () => {
  it('去重键与 dismissMerge 只接受同类现存资产', () => {
    expect(pairKey('b', 'a')).toBe('a|b')
    const doc = {
      ...emptyStoryboard('p1'),
      characters: [{ id: 'c1', name: '甲', description: '', aliases: [] }],
      scenes: [{ id: 's1', name: '场景', description: '', aliases: [] }],
    }
    expect(dismissMerge(doc, 'char', 'c1', 's1', 1)).toBe(doc)
    const same = dismissMerge(doc, 'scene', 's1', 's1', 2)
    expect(same).toBe(doc)
  })

  it('换节点清旧产物；同值空操作；结果合并只覆盖真实产物字段', () => {
    const doc = {
      ...emptyStoryboard('p1'),
      characters: [{ id: 'c1', name: '甲', description: '', aliases: [] }],
      shots: [{ ...shot, nodeId: 'old', imageHash: 'old-hash', videoHash: 'old-video' }],
    }
    expect(shotsNeedingNode([doc.shots[0]!], new Set(['old']))).toEqual([])
    expect(shotsNeedingNode([doc.shots[0]!], new Set())).toHaveLength(1)
    const attached = attachShotNodes(doc, [{ shotId: 'sh1', nodeId: 'new' }], 3)
    expect(attached.shots[0]).toMatchObject({ nodeId: 'new' })
    for (const key of ['imageHash', 'videoHash'] as const) {
      expect(key in attached.shots[0]!).toBe(false)
    }
    expect(attachShotImages(attached, [{ shotId: 'sh1', hash: 'h1' }], 4).shots[0]?.imageHash).toBe('h1')
    const unchanged = attachShotImages(doc, [{ shotId: 'sh1', hash: 'old-hash' }], 5)
    expect(unchanged).toBe(doc)

    const produced = {
      ...doc,
      characters: [{ ...doc.characters[0]!, baseHash: 'base' }],
      shots: [{ ...shot, scene: '执行期旧文案', imageHash: 'new-hash' }],
    }
    const merged = mergeStoryboardRunResults(
      { ...doc, shots: [{ ...shot, scene: '用户新文案' }] },
      produced,
      6,
    )
    expect(merged.shots[0]?.scene).toBe('用户新文案')
    expect(merged.shots[0]?.imageHash).toBe('new-hash')
    expect(merged.characters[0]?.baseHash).toBe('base')
  })

  it('资产节点/hash 镜像互不顶替，换节点清掉旧 hash', () => {
    const doc = {
      ...emptyStoryboard('p1'),
      scenes: [{ id: 's1', name: '场景', description: '', aliases: [] }],
    }
    const withHash = setAssetBaseHash(doc, 'scene', 's1', 'old-hash', 1)
    const changed = setAssetNode(withHash, 'scene', 's1', 'node-2', 2)
    expect(changed.scenes[0]).toMatchObject({ nodeId: 'node-2' })
    expect('baseHash' in changed.scenes[0]!).toBe(false)
    expect(setAssetBaseHash(withHash, 'scene', 's1', 'old-hash', 3)).toBe(withHash)
  })
})
