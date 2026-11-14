import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BUDGET,
  BUDGET,
  LEGACY,
  MAX_LINE_CHARS,
  judgeDoc,
  limitsFor,
  measureText,
} from './check-doc-size.mjs'

describe('measureText', () => {
  it('does not count the trailing newline as a line', () => {
    expect(measureText('a\nb\nc\n').lineCount).toBe(3)
  })

  it('counts CRLF and LF the same way', () => {
    expect(measureText('a\r\nb\r\n').lineCount).toBe(2)
    expect(measureText('a\nb\n').lineCount).toBe(2)
  })

  it('reports the longest line and its 1-based number', () => {
    const m = measureText('short\nlonger line\nx\n')
    expect(m.maxLine).toBe('longer line'.length)
    expect(m.maxLineNo).toBe(2)
  })

  it('treats an empty document as zero lines', () => {
    expect(measureText('').lineCount).toBe(0)
  })
})

describe('limitsFor', () => {
  it('prefers an explicit budget over the frozen legacy baseline', () => {
    // 拆分后的对账清单在 BUDGET 里（目标 400 行），不再走冻结基线
    expect(limitsFor('轻画-功能对账清单.md')).toEqual({ limit: BUDGET['轻画-功能对账清单.md'], kind: '目标' })
  })

  it('keeps an un-split document on its frozen baseline', () => {
    const rel = '轻画-Agent设计文档.md'
    expect(LEGACY[rel]).toBeGreaterThan(0)
    expect(limitsFor(rel)).toEqual({ limit: LEGACY[rel], kind: '冻结基线' })
  })

  it('falls back to the default budget for unregistered documents', () => {
    expect(limitsFor('docs/新章节.md')).toEqual({ limit: DEFAULT_BUDGET, kind: '默认' })
  })

  it('never puts a line budget on a generated file', () => {
    expect(limitsFor('ledger/README.md')).toEqual({ limit: Number.POSITIVE_INFINITY, kind: '生成物' })
  })
})

describe('judgeDoc', () => {
  it('lets a generated index grow without a line budget', () => {
    expect(
      judgeDoc({
        rel: 'ledger/README.md',
        bytes: 4096,
        lineCount: 900,
        maxLine: 120,
        maxLineNo: 1,
      }),
    ).toEqual([])
  })

  it('still fails a generated file with an absurd single line', () => {
    const problems = judgeDoc({
      rel: 'ledger/README.md',
      bytes: 4096,
      lineCount: 900,
      maxLine: MAX_LINE_CHARS + 1,
      maxLineNo: 3,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('第 3 行')
  })

  it('tells archives they may append in the current month or start a new file', () => {
    const problems = judgeDoc({
      rel: 'ledger/按批记录-2026-11.md',
      bytes: 2048,
      lineCount: LEGACY['ledger/按批记录-2026-11.md'] + 5,
      maxLine: 100,
      maxLineNo: 1,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('新建')
    expect(problems[0]).toContain('ledger-index.mjs')
  })
  it('passes a document at exactly its baseline', () => {
    const rel = '轻画-开发计划.md'
    expect(
      judgeDoc({ rel, bytes: 1024, lineCount: LEGACY[rel], maxLine: 100, maxLineNo: 1 }),
    ).toEqual([])
  })

  it('fails a frozen document that grew by one line', () => {
    const rel = '轻画-开发计划.md'
    const problems = judgeDoc({
      rel,
      bytes: 1024,
      lineCount: LEGACY[rel] + 1,
      maxLine: 100,
      maxLineNo: 1,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('冻结基线')
    expect(problems[0]).toContain('超 1 行')
  })

  it('fails a new document above the default budget', () => {
    const problems = judgeDoc({
      rel: 'docs/新章节.md',
      bytes: 1024,
      lineCount: DEFAULT_BUDGET + 5,
      maxLine: 100,
      maxLineNo: 1,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('默认')
  })

  it('fails a single absurdly long line even when the line count is fine', () => {
    const problems = judgeDoc({
      rel: 'docs/新章节.md',
      bytes: 1024,
      lineCount: 10,
      maxLine: MAX_LINE_CHARS + 1,
      maxLineNo: 7,
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('第 7 行')
  })
})
