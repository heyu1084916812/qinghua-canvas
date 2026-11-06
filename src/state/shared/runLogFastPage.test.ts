import { describe, expect, it, vi } from 'vitest'
import type { StoragePort } from '../../platform/ports'
import type { RunRecord } from '../../domain/shared/execution/runRecord'
import { runLogFastFirstPage } from './runLogFastPage'

describe('runLogFastFirstPage', () => {
  it('只请求首页候选并去掉探针，用 hasMore 表示可继续加载', async () => {
    const calls: Array<{ limit: number }> = []
    const page = await runLogFastFirstPage(
      async (filter) => {
        calls.push({ limit: filter.limit ?? 0 })
        return {
          entries: [
            { record: { id: 'r1' } },
            { record: { id: 'r2' } },
            { record: { id: 'r3' } },
          ],
        } as never
      },
      { aggregate: true },
      2,
    )

    expect(calls).toEqual([{ limit: 3 }])
    expect(page.entries.map((entry) => entry.record.id)).toEqual(['r1', 'r2'])
    expect(page.hasMore).toBe(true)
  })

  it('刚好到页尾时不再显示加载更多', async () => {
    const page = await runLogFastFirstPage(
      async () => ({ entries: [{ record: { id: 'r1' } }] } as never),
      { aggregate: true },
      2,
    )
    expect(page.hasMore).toBe(false)
  })

  it('探针用于候选过滤，负载不影响返回数量', async () => {
    const rows: RunRecord[] = [
      { id: 'r1', createdAt: 3 } as RunRecord,
      { id: 'r2', createdAt: 2 } as RunRecord,
    ]
    const storage = {
      queryPage: vi.fn(async () => ({ rows, total: 99 })),
    } as unknown as StoragePort
    const { runLogStorageFastFirstPage } = await import('./runLogFastPage')
    const loaded = await runLogStorageFastFirstPage(storage, {}, 2, [])
    expect(loaded.map((row) => row.id)).toEqual(['r1', 'r2'])
    expect(storage.queryPage).toHaveBeenCalledWith(
      'runRecords',
      {},
      expect.objectContaining({ limit: 3, offset: 0 }),
    )
  })
})
