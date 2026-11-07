import type { RunRecord } from '../../../domain/canvas/model/runRecord'
import type { CanvasLogPage } from './canvasLogQuery'

/** 继续加载沿用同一过滤规则；“清空”只作用于已加载记录，避免大历史误删。 */
export function canvasLogAppendPage<TRecord extends RunRecord>(
  loaded: readonly TRecord[],
  nextEntries: readonly TRecord[],
  hasMore: boolean,
  nextOffset: number,
): CanvasLogPage<TRecord> {
  const seen = new Set(loaded.map((record) => record.id))
  const additions = nextEntries.filter((record) => !seen.has(record.id))
  const entries = [...loaded, ...additions]
  return { entries, hasMore, nextOffset }
}
