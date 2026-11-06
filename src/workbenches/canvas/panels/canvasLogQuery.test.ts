import { describe, expect, it } from 'vitest'
import type { RunRecord } from '../../../domain/canvas/model/runRecord'
import {
  canvasLogAppendPage,
  canvasLogFirstPage,
} from './canvasLogQuery'

function row(id: string): RunRecord {
  return { id, params: { kind: 'image' } } as unknown as RunRecord
}

describe('canvasLogQuery', () => {
  it('首屏只保留最近一页并给出是否还有更多', () => {
    const page = canvasLogFirstPage([row('r3'), row('r2'), row('r1')], 2)
    expect(page.entries.map((record) => record.id)).toEqual(['r3', 'r2'])
    expect(page.hasMore).toBe(true)
    expect(canvasLogFirstPage([row('r3')], 2).hasMore).toBe(false)
  })

  it('继续加载去重；候选含重复时按是否有新增判断下一页', () => {
    const first = canvasLogFirstPage([row('r3'), row('r2')], 2)
    const next = canvasLogAppendPage(first.entries, [row('r2'), row('r1')])
    expect(next.entries.map((record) => record.id)).toEqual(['r3', 'r2', 'r1'])
    expect(next.hasMore).toBe(true)

    const duplicated = canvasLogAppendPage(next.entries, [row('r1')])
    expect(duplicated.entries).toHaveLength(3)
    expect(duplicated.hasMore).toBe(true)
  })
})
