import { describe, expect, it } from 'vitest'
import {
  moveClipperItems,
  normalizeClipperCategories,
  normalizeClipperCategory,
  normalizeClipperItems,
  removeClipperItem,
  removeClipperItems,
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

  it('keeps only safe original-image alternatives', () => {
    expect(normalizeClipperItems([{
      ...item,
      imageUrls: [
        'https://example.com/original.jpg',
        item.imageUrl,
        'javascript:alert(1)',
        'https://example.com/original.jpg',
      ],
    }])).toEqual([{
      ...item,
      imageUrls: ['https://example.com/original.jpg'],
    }])
  })

  it('upserts by page + image and keeps latest copy', () => {
    const updated = { ...item, title: 'Updated', collectedAt: 20 }
    expect(upsertClipperItems([item], [updated])).toEqual([updated])
  })

  it('removes one collection row', () => {
    expect(removeClipperItem([item], item.id)).toEqual([])
  })

  it('normalizes categories and moves or removes multiple rows', () => {
    const second = { ...item, id: 'clip-2', category: '灵感' }
    expect(normalizeClipperCategory('   ')).toBe('未分类')
    expect(normalizeClipperCategories([
      '灵感',
      ' 灵感 ',
      '未分类',
      '工作',
    ])).toEqual(['灵感', '工作'])
    expect(moveClipperItems([item, second], [item.id], '工作')).toEqual([
      { ...item, category: '工作' },
      second,
    ])
    expect(removeClipperItems([item, second], [item.id, second.id])).toEqual([])
  })
})
