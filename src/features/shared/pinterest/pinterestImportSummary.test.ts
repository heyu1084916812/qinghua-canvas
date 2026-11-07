import { describe, expect, it } from 'vitest'
import type {
  PinterestBoard,
  PinterestPin,
} from '../../../domain/inspiration/pinterest'
import type { PinterestPageResult } from './pinterestApi'
import {
  pinterestImportStatus,
  pinterestPinStatus,
  summarizePinterestImportResults,
  summarizePinterestPinLoads,
} from './pinterestImportSummary'

describe('pinterestImportSummary', () => {
  it('summarizes per-board success and failure without losing successful boards', () => {
    const boardA: PinterestBoard = { id: 'a', name: 'A', pinCount: 2 }
    const boardB: PinterestBoard = { id: 'b', name: 'B', pinCount: 2 }
    const pins = [1, 2].map<PinterestPin>((index) => ({
      id: `a${index}`,
      boardId: 'a',
      title: `Pin ${index}`,
      imageUrl: `https://i.pinimg.com/${index}.jpg`,
    }))
    const success: PinterestPageResult<PinterestPin> = {
      items: pins,
      truncated: false,
      pageCount: 1,
    }

    const summary = summarizePinterestPinLoads([
      { board: boardA, outcome: { status: 'fulfilled', value: success } },
      {
        board: boardB,
        outcome: { status: 'rejected', reason: new Error('HTTP 500') },
      },
    ])

    expect(summary.items).toEqual(pins)
    expect(summary.failures).toEqual([
      { boardId: 'b', boardName: 'B', reason: 'HTTP 500' },
    ])
  })

  it('reports partial import success, failures and cancellation without losing saved counts', () => {
    const summary = summarizePinterestImportResults([
      { pinId: 'a', title: 'A', ok: true },
      { pinId: 'b', title: 'B', ok: false, reason: '下载失败' },
    ], [])
    expect(pinterestImportStatus(summary, false)).toContain('已保存 1 张')
    expect(pinterestImportStatus(summary, false)).toContain('失败 1 张')
    expect(pinterestImportStatus(summary, true, true)).toContain('导入已停止')
  })

  it('reports truncated pin pages and failed boards in visible status text', () => {
    const status = pinterestPinStatus({
      items: [],
      truncated: true,
      pageCount: 20,
      failures: [{ boardId: 'b', boardName: 'B', reason: 'HTTP 500' }],
    })
    expect(status).toContain('20 页安全上限')
    expect(status).toContain('B（HTTP 500）')
  })
})
