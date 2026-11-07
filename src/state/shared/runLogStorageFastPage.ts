import type { RunRecord } from '../../domain/shared/execution/runRecord'
import type { StoragePort } from '../../platform/ports'

/** 首页候选直接从 storage 下推分页读取；旧存储退回一次 query 后在内存里截页。 */
export async function runLogStorageFastFirstPage(
  storage: StoragePort,
  storageFilter: Record<string, unknown>,
  pageSize: number,
  ranges: readonly { field: string; from?: number; to?: number }[],
  missingFields?: readonly string[],
): Promise<RunRecord[]> {
  const limit = Math.max(0, pageSize + 1)
  const queryPage = storage.queryPage?.bind(storage)
  if (queryPage) {
    const page = await queryPage('runRecords', storageFilter as never, {
      missingFields,
      ranges,
      orderBy: { field: 'createdAt', direction: 'desc' },
      offset: 0,
      limit,
    })
    return page.rows as unknown as RunRecord[]
  }
  const rows = (await storage.query(
    'runRecords',
    storageFilter as never,
  )) as unknown as RunRecord[]
  return rows
    .filter((record) =>
      matchesStorageFastFilter(record, storageFilter, missingFields, ranges),
    )
    .sort(compareCreatedAtDesc)
    .slice(0, limit)
}

function matchesStorageFastFilter(
  record: RunRecord,
  filter: Record<string, unknown>,
  missingFields: readonly string[] | undefined,
  ranges: readonly { field: string; from?: number; to?: number }[],
): boolean {
  const row = record as unknown as Record<string, unknown>
  if (
    !Object.entries(filter).every(
      ([key, value]) => value === undefined || row[key] === value,
    )
  ) return false
  if (missingFields?.some((field) => row[field] !== undefined)) return false
  for (const range of ranges) {
    const value = row[range.field]
    if (typeof value !== 'number') return false
    if (range.from !== undefined && value < range.from) return false
    if (range.to !== undefined && value > range.to) return false
  }
  return true
}

function compareCreatedAtDesc(a: RunRecord, b: RunRecord): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}
