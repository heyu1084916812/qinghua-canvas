import { describe, expect, it } from 'vitest'
import {
  clampSpeechSpeed,
  clampTransitionSeconds,
  clampVolume,
  DEFAULT_BGM_VOLUME,
  DEFAULT_SHOT_SECONDS,
  emptyStoryboard,
  num,
  text,
} from './model'

describe('storyboard · 项目与分集规范', () => {
  it('空文档与边界夹取只使用领域默认值', () => {
    expect(emptyStoryboard('p1', 7)).toEqual({
      projectId: 'p1',
      sourceText: '',
      script: { title: '未命名漫剧', logline: '', body: '' },
      characters: [],
      scenes: [],
      episodes: [],
      shots: [],
      updatedAt: 7,
    })
    expect(DEFAULT_BGM_VOLUME).toBe(0.2)
    expect(DEFAULT_SHOT_SECONDS).toBe(3)
    expect(clampTransitionSeconds(0)).toBe(0.1)
    expect(clampTransitionSeconds(8)).toBe(1)
    expect(clampTransitionSeconds('bad')).toBe(0.3)
    expect(clampVolume(2)).toBe(1)
    expect(clampVolume({})).toBe(0.2)
    expect(clampSpeechSpeed('4.5', 1)).toBe(4)
    expect(clampSpeechSpeed(1, 1)).toBe(1)
    expect(text(42, 'fallback')).toBe('fallback')
    expect(num('3', 9)).toBe(9)
  })
})
