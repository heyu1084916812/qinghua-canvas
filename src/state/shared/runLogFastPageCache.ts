import type { StoragePort } from '../../platform/ports'
import type { RunLogFastPage } from './runLogFastPage'
import type { RunLogQuery } from './runLogRepository'

const pages = new WeakMap<StoragePort, Map<string, RunLogFastPage>>()

function keyOf(filter: Omit<RunLogQuery, 'offset' | 'limit'>, pageSize: number): string {
  return `${pageSize}:${JSON.stringify(filter)}`
}

/** Read the last first page for the same storage + filter during this session. */
export function readRunLogFastPageCache(
  storage: StoragePort,
  filter: Omit<RunLogQuery, 'offset' | 'limit'>,
  pageSize: number,
): RunLogFastPage | null {
  return pages.get(storage)?.get(keyOf(filter, pageSize)) ?? null
}

/** Cache only the first page; later pages remain query-driven and are not duplicated in memory. */
export function rememberRunLogFastPage(
  storage: StoragePort,
  filter: Omit<RunLogQuery, 'offset' | 'limit'>,
  pageSize: number,
  page: RunLogFastPage,
): void {
  const byFilter = pages.get(storage) ?? new Map<string, RunLogFastPage>()
  byFilter.set(keyOf(filter, pageSize), page)
  pages.set(storage, byFilter)
}
