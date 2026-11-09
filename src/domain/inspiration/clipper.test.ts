import { describe, expect, it } from 'vitest'
import {
  normalizeClipperItems,
  removeClipperItem,
  upsertClipperItems,
} from './clipper'

const item = {
  id: 'clip-1',
  source: 'web' as const,
  title: 'Warm oak',
  url: 'https://example.com/page',
  imageUrl: 'https://example.com/image.jpg',
  collectedAt: 10,
  category: '未分类',
}

describe('clipper collection rules', () => {
  it('normalizes real public HTTP items and drops incomplete rows', () => {
    expect(normalizeClipperItems([
      item,
      { ...item, id: 'bad-url', imageUrl: 'javascript:alert(1)' },
      { ...item, id: 'duplicate' },
    ])).toEqual([item])
  })

  it('upserts by page + image and keeps latest copy', () => {
    const updated = { ...item, title: 'Updated', collectedAt: 20 }
    expect(upsertClipperItems([item], [updated])).toEqual([updated])
  })

  it('removes one collection row', () => {
    expect(removeClipperItem([item], item.id)).toEqual([])
  })
})
