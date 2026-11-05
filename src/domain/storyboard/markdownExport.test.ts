import { describe, expect, it } from 'vitest'
import { emptyStoryboard, type StoryboardShot } from './model'
import { cell, exportStoryboardMarkdown } from './markdownExport'

describe('storyboard · Markdown 导出', () => {
  it('转义竖线/换行、空集不输出表头，并以单个换行结束', () => {
    const shot: StoryboardShot = {
      id: 'sh1',
      episodeId: 'ep1',
      scene: '客厅 | 厨房\n转身',
      lines: [{ id: 'l1', text: '早啊' }],
      durationSec: 3,
      prompt: '',
    }
    const doc = {
      ...emptyStoryboard('p1'),
      script: { title: '雨夜', logline: '一句话', body: '' },
      episodes: [
        { id: 'ep1', title: '第一集', summary: '' },
        { id: 'ep2', title: '第二集', summary: '' },
      ],
      shots: [shot],
    }
    const markdown = exportStoryboardMarkdown(doc)
    expect(cell('')).toBe('—')
    expect(cell('a|b\nc')).toBe('a\\|b c')
    expect(markdown).toContain('| 1 | 客厅 \\| 厨房 转身 | — | — | 早啊 | 3s | 客厅 \\| 厨房 转身 |')
    expect(markdown).toContain('（这一集还没有分镜）')
    expect(markdown.endsWith('\n')).toBe(true)
    expect(markdown.endsWith('\n\n')).toBe(false)
  })
})
