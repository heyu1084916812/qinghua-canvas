import { describe, expect, it } from 'vitest'
import { emptyStoryboard } from './model'
import {
  addCharacter,
  addScene,
  bindShotScene,
  mergeAsset,
  removeCharacter,
  removeScene,
  toggleShotCharacter,
  updateCharacter,
  updateScene,
} from './assetEditing'
import { addEpisode, addShot } from './editing'

describe('storyboard · 资产库编辑', () => {
  it('新增、改名、别名去重和不存在资产空操作', () => {
    let doc = addCharacter(emptyStoryboard('p1'), 1)
    doc = addScene(doc, 2)
    expect(doc.characters[0]?.name).toBe('角色 1')
    expect(doc.scenes[0]?.name).toBe('场景 1')
    const characterId = doc.characters[0]!.id
    doc = updateCharacter(doc, characterId, {
      name: '骑手',
      aliases: ['小哥', '骑手', '小哥'],
      speed: 1,
    }, 3)
    expect(doc.characters[0]?.aliases).toEqual(['小哥'])
    expect('speed' in doc.characters[0]!).toBe(false)
    expect(updateScene(doc, 'missing', { name: '无' }, 4)).toBe(doc)
  })

  it('删除资产同时清理镜头引用；绑定只认存在的场景', () => {
    let doc = addCharacter(emptyStoryboard('p1'), 1)
    doc = addScene(doc, 2)
    doc = addEpisode(doc, 3)
    const shotDoc = addShot(doc, doc.episodes[0]!.id, 4)
    const characterId = doc.characters[0]!.id
    const sceneId = doc.scenes[0]!.id
    const shotId = shotDoc.shots[0]!.id
    doc = bindShotScene(shotDoc, shotId, sceneId, 5)
    doc = toggleShotCharacter(doc, shotId, characterId, 6)
    expect(doc.shots[0]).toMatchObject({ sceneId, characterIds: [characterId] })
    expect(bindShotScene(doc, shotId, 'missing', 7)).toBe(doc)
    doc = removeCharacter(doc, characterId, 8)
    expect('characterIds' in doc.shots[0]!).toBe(false)
    doc = removeScene(doc, sceneId, 9)
    expect('sceneId' in doc.shots[0]!).toBe(false)
  })

  it('合并资产把引用和缺失基准图带过来，非法 id 返回原引用', () => {
    let doc = addCharacter(emptyStoryboard('p1'), 1)
    doc = addCharacter(doc, 2)
    const [keep, drop] = doc.characters
    doc = {
      ...doc,
      characters: doc.characters.map((character, index) =>
        index === 1
          ? { ...character, baseHash: 'hash', nodeId: 'node', description: '备用描述' }
          : character,
      ),
      shots: [
        {
          id: 'sh1',
          episodeId: 'ep1',
          scene: '',
          lines: [],
          durationSec: 3,
          prompt: '',
          characterIds: [keep!.id, drop!.id],
        },
      ],
    }
    const merged = mergeAsset(doc, 'char', keep!.id, drop!.id, 10)
    expect(merged.characters).toHaveLength(1)
    expect(merged.characters[0]).toMatchObject({ baseHash: 'hash', nodeId: 'node', description: '备用描述' })
    expect(merged.shots[0]?.characterIds).toEqual([keep!.id])
    expect(mergeAsset(doc, 'char', keep!.id, keep!.id, 11)).toBe(doc)
  })
})
