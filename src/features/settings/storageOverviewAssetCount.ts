import type { StoragePort } from '../../platform/ports'
import {
  countAssetRecords,
  countAssets,
  type LibraryCountRow,
} from '../../domain/shared/assetHistory'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'

export type StorageAssetCounts = ReturnType<typeof countAssets>

/** 只取元数据时可以比通用素材扫描更宽，减少大库的请求轮次。 */
const COUNT_SCAN_BATCH = 256

/** 只读 hash/MIME/时间等最小字段，避免为了存储计数构造完整历史卡片。 */
export async function countStorageAssets(
  storage: StoragePort,
  now = Date.now(),
): Promise<StorageAssetCounts> {
  const [runs, rawLibrary, hidden] = await Promise.all([
    storage.query(
      'runRecords',
      {},
      {
        includePayload: false,
        fields: ['createdAt', 'outputHashes'],
      },
    ),
    storage.query(
      'assetLibrary',
      {},
      {
        includePayload: false,
        fields: ['id', 'hash', 'mime', 'savedAt', 'createdAt'],
      },
    ),
    createAssetLibraryRepository(storage).listHidden(),
  ])

  const outputTimes = new Map<string, number>()
  for (const run of runs) {
    const createdAt = typeof run.createdAt === 'number' ? run.createdAt : 0
    const hashes = Array.isArray(run.outputHashes) ? run.outputHashes : []
    for (const hash of hashes) {
      if (typeof hash !== 'string' || !hash || hidden.has(hash)) continue
      outputTimes.set(hash, Math.max(outputTimes.get(hash) ?? 0, createdAt))
    }
  }

  const mimeByHash = new Map<string, string>()
  const collectMimes = (rows: readonly Record<string, unknown>[]) => {
    for (const row of rows) {
      const hash =
        typeof row.hash === 'string'
          ? row.hash
          : typeof row.id === 'string'
            ? row.id
            : ''
      if (!hash || !outputTimes.has(hash) || typeof row.mime !== 'string') continue
      mimeByHash.set(hash, row.mime)
    }
  }
  if (storage.scan) {
    await storage.scan(
      'assets',
      COUNT_SCAN_BATCH,
      async (rows) => collectMimes(rows as unknown as Record<string, unknown>[]),
      { includePayload: false },
    )
  } else {
    collectMimes(
      (await storage.query('assets', {}, { includePayload: false })) as unknown as Record<
        string,
        unknown
      >[],
    )
  }

  const records = [...outputTimes].map(([hash, createdAt]) => ({
    hash,
    mime: mimeByHash.get(hash) ?? 'application/octet-stream',
    createdAt,
  }))
  const library = (rawLibrary as LibraryCountRow[]).filter((row) => {
    const hash =
      typeof row.hash === 'string' ? row.hash : typeof row.id === 'string' ? row.id : ''
    return !hash || !hidden.has(hash)
  })
  return countAssetRecords(records, library, now)
}
