import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob('./*.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

describe('storyboard video execution / error copy preservation', () => {
  it('keeps both original postprocess failure messages in their respective branches', () => {
    const state = SOURCES['./executionState.ts'] ?? ''
    expect(state).toContain('视频后处理没有返回可用结果')
    expect(state).toContain('视频后处理没有返回视频产物')
  })
})
