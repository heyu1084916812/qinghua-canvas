import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { PlatformKit, StoragePort } from '../platform/ports'
import {
  subscribeThumbBackfill,
  resetThumbBackfillForTest,
  THUMB_BACKFILL_MARKER_ID,
} from './thumbBackfillRun'

vi.mock('../platform/assetThumb', () => ({
  backfillAssetThumbs: vi.fn(),
}))

import { backfillAssetThumbs } from '../platform/assetThumb'

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function makePlatform(opts: { marked?: boolean } = {}) {
  const queries: Array<{ table: string; filter: unknown }> = []
  const puts: Array<{ table: string; row: unknown }> = []
  const logs: Array<{ level: string; msg: string }> = []
  const storage = {
    query: vi.fn(async (table: string, filter: unknown) => {
      queries.push({ table, filter })
      return opts.marked ? [{ id: THUMB_BACKFILL_MARKER_ID }] : []
    }),
    put: vi.fn(async (table: string, row: unknown) => {
      puts.push({ table, row })
    }),
  } as unknown as StoragePort
  const platform = {
    storage,
    logger: {
      log: (level: string, msg: string) => {
        logs.push({ level, msg })
      },
    },
  } as unknown as PlatformKit
  return { platform, storage, queries, puts, logs }
}

describe('thumbBackfillRun 去重控制器', () => {
  beforeEach(() => {
    vi.mocked(backfillAssetThumbs).mockReset()
    vi.mocked(backfillAssetThumbs).mockResolvedValue({
      scanned: 3,
      generated: 2,
      aborted: false,
    })
  })

  it('StrictMode 两次挂载只跑一次标记读取与补图', async () => {
    const { platform, storage, queries } = makePlatform()
    resetThumbBackfillForTest(storage)
    const a = subscribeThumbBackfill(platform)
    a.release() // StrictMode 卸载
    const b = subscribeThumbBackfill(platform)
    await flush()
    expect(queries).toHaveLength(1)
    expect(backfillAssetThumbs).toHaveBeenCalledTimes(1)
    b.release()
  })

  it('标记已存在时跳过补图，且本会话内后续挂载不再读标记', async () => {
    const { platform, storage, queries } = makePlatform({ marked: true })
    resetThumbBackfillForTest(storage)
    const a = subscribeThumbBackfill(platform)
    await flush()
    a.release()
    expect(backfillAssetThumbs).not.toHaveBeenCalled()
    expect(queries).toHaveLength(1)
    const b = subscribeThumbBackfill(platform)
    await flush()
    b.release()
    expect(queries).toHaveLength(1)
  })

  it('成功后写入标记并 log info；本会话内后续挂载不再读标记', async () => {
    const { platform, storage, queries, puts, logs } = makePlatform()
    resetThumbBackfillForTest(storage)
    const a = subscribeThumbBackfill(platform)
    await flush()
    a.release()
    expect(puts).toHaveLength(1)
    expect((puts[0].row as { id: string }).id).toBe(THUMB_BACKFILL_MARKER_ID)
    expect(logs.some((l) => l.level === 'info')).toBe(true)
    const b = subscribeThumbBackfill(platform)
    await flush()
    b.release()
    expect(queries).toHaveLength(1)
  })

  it('一个订阅者取消不影响仍活跃订阅者的成功结果', async () => {
    const { platform, storage, puts } = makePlatform()
    resetThumbBackfillForTest(storage)
    let resolveBackfill!: (v: { scanned: number; generated: number; aborted: boolean }) => void
    vi.mocked(backfillAssetThumbs).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBackfill = resolve
        }),
    )
    const a = subscribeThumbBackfill(platform)
    const b = subscribeThumbBackfill(platform)
    a.release() // a 走了，b 还在
    await flush() // 等标记读完后补图已启动
    resolveBackfill({ scanned: 1, generated: 1, aborted: false })
    await flush()
    b.release()
    expect(puts).toHaveLength(1)
  })

  it('全部订阅者退出会中断补图，且不写标记', async () => {
    const { platform, storage, puts } = makePlatform()
    resetThumbBackfillForTest(storage)
    vi.mocked(backfillAssetThumbs).mockImplementation(
      (_p, opts?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          opts?.signal?.addEventListener('abort', () =>
            resolve({ scanned: 0, generated: 0, aborted: true }),
          )
        }),
    )
    const a = subscribeThumbBackfill(platform)
    a.release()
    await flush()
    expect(puts).toHaveLength(0)
  })

  it('补图失败后静默 log warn，下一次挂载可重试', async () => {
    const { platform, storage, logs } = makePlatform()
    resetThumbBackfillForTest(storage)
    vi.mocked(backfillAssetThumbs).mockRejectedValueOnce(new Error('boom'))
    const a = subscribeThumbBackfill(platform)
    await flush()
    a.release()
    expect(logs.some((l) => l.level === 'warn')).toBe(true)
    const b = subscribeThumbBackfill(platform)
    await flush()
    b.release()
    expect(backfillAssetThumbs).toHaveBeenCalledTimes(2)
  })
})
