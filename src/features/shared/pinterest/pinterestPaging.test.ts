import { describe, expect, it } from 'vitest'
import { pinterestPagedResult } from './pinterestPaging'

describe('pinterestPagedResult', () => {
  it('stops at an empty bookmark without reporting truncation', async () => {
    const result = await pinterestPagedResult(
      async () => ({ items: [{ id: 'a' }], bookmark: '' }),
      (raw) => (raw as { id: string }).id ? (raw as { id: string }) : null,
      (item) => item.id,
    )
    expect(result).toEqual({ items: [{ id: 'a' }], truncated: false, pageCount: 1 })
  })

  it('reports truncation after the 20-page safety limit', async () => {
    let reads = 0
    const result = await pinterestPagedResult(
      async () => { reads += 1; return { items: [], bookmark: 'next' } },
      () => null,
      () => '',
    )
    expect(result.truncated).toBe(true)
    expect(result.pageCount).toBe(20)
    expect(reads).toBe(20)
  })
})
