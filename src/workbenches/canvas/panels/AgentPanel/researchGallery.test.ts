import { describe, expect, it } from 'vitest'
import {
  researchHostOf,
  researchImageItems,
  researchPreviewItems,
  researchWebItems,
} from './researchGallery'
import type { ConversationResearchItem } from './conversation'

const item = (
  id: string,
  url: string,
  imageUrl: string,
): ConversationResearchItem => ({
  id,
  title: id,
  url,
  imageUrl,
  source: 'tavily',
})

describe('researchGallery', () => {
  it('dedupes image and webpage entries independently', () => {
    const rows = [
      item('a', 'https://www.behance.net/a', 'https://cdn.example.com/a.jpg'),
      item('b', 'https://www.behance.net/a', 'https://cdn.example.com/a.jpg'),
      item('c', 'https://www.behance.net/c', ''),
      item('d', 'https://cdn.example.com/d.jpg', 'https://cdn.example.com/d.jpg'),
    ]
    expect(researchImageItems(rows).map((row) => row.id)).toEqual(['a', 'd'])
    expect(researchWebItems(rows).map((row) => row.id)).toEqual(['a', 'c'])
    expect(researchPreviewItems(rows, 1).map((row) => row.id)).toEqual(['a'])
  })

  it('normalizes common source hosts for labels', () => {
    expect(researchHostOf('https://www.pinterest.com/pin/1')).toBe('pinterest.com')
    expect(researchHostOf('bad url')).toBe('')
  })
})
