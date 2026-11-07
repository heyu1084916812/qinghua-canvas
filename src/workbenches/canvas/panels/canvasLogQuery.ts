import type { RunRecord } from '../../../domain/canvas/model/runRecord'

export interface CanvasLogPage<TRecord extends RunRecord = RunRecord> {
  entries: TRecord[]
  /** 候选页返回 size + 1 时为 true；不能据此精确知道剩余数。 */
  hasMore: boolean
  /** 已消费的原始候选数；文本候选和探针都不应把它改成已渲染记录数。 */
  nextOffset: number
}

/** 画布日志只查当前项目，先渲染最近一页生成记录，不在首屏反序列化全部历史。 */
export function canvasLogFirstPage<TRecord extends RunRecord>(
  records: readonly TRecord[],
  pageSize: number,
  hasMore = records.length > pageSize,
  nextOffset = Math.min(records.length, pageSize),
): CanvasLogPage<TRecord> {
  return {
    entries: records.slice(0, pageSize),
    hasMore,
    nextOffset,
  }
}
export { canvasLogAppendPage } from './canvasLogAppend'
