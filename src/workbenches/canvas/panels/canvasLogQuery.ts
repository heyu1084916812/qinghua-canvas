import type { RunRecord } from '../../../domain/canvas/model/runRecord'

export interface CanvasLogPage<TRecord extends RunRecord = RunRecord> {
  entries: TRecord[]
  /** 候选页返回 size + 1 时为 true；不能据此精确知道剩余数。 */
  hasMore: boolean
}

/** 画布日志只查当前项目，先渲染最近一页生成记录，不在首屏反序列化全部历史。 */
export function canvasLogFirstPage<TRecord extends RunRecord>(
  records: readonly TRecord[],
  pageSize: number,
  hasMore = records.length > pageSize,
): CanvasLogPage<TRecord> {
  return {
    entries: records.slice(0, pageSize),
    hasMore,
  }
}

/** 继续加载沿用同一过滤规则；“清空”只作用于已加载记录，避免大历史误删。 */
export function canvasLogAppendPage<TRecord extends RunRecord>(
  loaded: readonly TRecord[],
  nextEntries: readonly TRecord[],
  hasMore: boolean,
): CanvasLogPage<TRecord> {
  const seen = new Set(loaded.map((record) => record.id))
  const additions = nextEntries.filter((record) => !seen.has(record.id))
  const entries = [...loaded, ...additions]
  return { entries, hasMore }
}
