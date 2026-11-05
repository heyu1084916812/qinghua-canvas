import { describe, expect, it } from 'vitest'
import { parseStoryboard } from './normalization'

describe('storyboard · 脏数据归一化', () => {
  it('只补坏项、丢孤儿镜头与悬空引用、幂等迁移旧对白', () => {
    const doc = parseStoryboard(
      {
        script: { title: 42, body: '正文' },
        characters: [
          { id: 'c1', name: '骑手', aliases: ['骑手', '小哥', '', 42], speed: '1.25' },
          { name: '没有 id' },
        ],
        scenes: [{ id: 's1', name: '街道', aliases: [] }],
        episodes: [{ id: 'e1', title: '', sourceRange: { from: 2, to: 1 } }],
        shots: [
          {
            id: 'sh1',
            episodeId: 'e1',
            dialogue: '旧台词',
            durationSec: 'bad',
            sceneId: 'missing',
            characterIds: ['c1', 'missing', 'c1'],
            transitionSec: 9,
          },
          { id: 'orphan', episodeId: 'missing' },
        ],
        mergeDismissals: ['c1|missing', 'c1|s1', 'c1|s1'],
      },
      'p1',
    )
    expect(doc.script.title).toBe('未命名漫剧')
    expect(doc.episodes[0]?.title).toBe('未命名一集')
    expect('sourceRange' in doc.episodes[0]!).toBe(false)
    expect(doc.characters[0]).toMatchObject({ aliases: ['小哥'], speed: 1.25 })
    expect(doc.shots.map((shot) => shot.id)).toEqual(['sh1'])
    expect(doc.shots[0]).toMatchObject({
      lines: [{ id: 'legacy-1', text: '旧台词' }],
      durationSec: 3,
      characterIds: ['c1'],
    })
    expect('sceneId' in doc.shots[0]!).toBe(false)
    expect('transitionSec' in doc.shots[0]!).toBe(false)
    expect(doc.mergeDismissals).toEqual(['c1|s1'])
    expect(parseStoryboard(doc, 'p2')).toEqual({ ...doc, projectId: 'p2' })
  })
})
