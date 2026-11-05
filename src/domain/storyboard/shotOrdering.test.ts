import { describe, expect, it } from 'vitest'
import { emptyStoryboard, type StoryboardShot } from './model'
import { normalizeShotOrder, shotsOf } from './shotOrdering'

const shot = (id: string, episodeId: string): StoryboardShot => ({
  id,
  episodeId,
  scene: '',
  lines: [],
  durationSec: 3,
  prompt: '',
})

describe('storyboard · 镜头整序', () => {
  it('集顺序优先且集内稳定；缺集镜头排在最后而不改变彼此先后', () => {
    const doc = {
      ...emptyStoryboard('p1'),
      episodes: [
        { id: 'e2', title: '第二集', summary: '' },
        { id: 'e1', title: '第一集', summary: '' },
      ],
      shots: [shot('a', 'e1'), shot('b', 'e2'), shot('c', 'e1'), shot('d', 'missing')],
    }
    expect(normalizeShotOrder(doc).map((row) => row.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(shotsOf(doc, 'e1').map((row) => row.id)).toEqual(['a', 'c'])
  })
})
