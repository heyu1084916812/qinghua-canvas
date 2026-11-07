import type {
  RunLogEntry,
  RunLogQuery,
} from './runLogRepository'

export interface RunLogFastPage {
  entries: RunLogEntry[]
  /** 首页只证明“还有更多”，不做全库精确计数。 */
  hasMore: boolean
  /** 本页实际消费的候选数；探针只用于 hasMore，不计入下页 offset。 */
  nextOffset: number
}

/** 首屏只取最近一页候选，跳过全表 count 和剩余记录的反序列化。 */
export async function runLogFastPage(
  repoQuery: (filter: RunLogQuery) => Promise<{
    entries: RunLogEntry[]
    hasMore?: boolean
  }>,
  filter: RunLogQuery,
  offset: number,
  pageSize: number,
): Promise<RunLogFastPage> {
  const pageOffset = Math.max(0, Math.trunc(offset))
  const page = await repoQuery({
    ...filter,
    offset: pageOffset,
    limit: pageSize + 1,
  })
  const entries = page.entries.slice(0, pageSize)
  return {
    entries,
    hasMore: page.hasMore === true || page.entries.length > pageSize,
    nextOffset: pageOffset + page.entries.length,
  }
}

/** 已渲染条目与候选游标分开；重复候选不会倒退游标。 */
export function runLogFastAppendPage(
  loaded: readonly RunLogEntry[],
  page: RunLogFastPage,
): RunLogFastPage {
  const seen = new Set(loaded.map((entry) => entry.record.id))
  const additions = page.entries.filter((entry) => !seen.has(entry.record.id))
  return {
    entries: [...loaded, ...additions],
    hasMore: page.hasMore,
    nextOffset: page.nextOffset,
  }
}

export function runLogFastFirstPage(
  repoQuery: (filter: RunLogQuery) => Promise<{
    entries: RunLogEntry[]
    hasMore?: boolean
  }>,
  filter: RunLogQuery,
  pageSize: number,
): Promise<RunLogFastPage> {
  return runLogFastPage(repoQuery, filter, 0, pageSize)
}
export { runLogStorageFastFirstPage } from './runLogStorageFastPage'
