import { describe, expect, it } from 'vitest'
import { isAdvanceTaskCommand, latestProcessLine } from './agentProcessText'

describe('agent process headline', () => {
  it('shows only the latest sentence while full text remains in the fold', () => {
    expect(latestProcessLine('先核对参考图。然后检查 Logo 比例。最后准备下一步。'))
      .toBe('最后准备下一步。')
  })

  it('supports multi-line provider reasoning and ignores blank rows', () => {
    expect(latestProcessLine('第一段\n\n第二段\n最后一行'))
      .toBe('最后一行')
  })

  it('returns empty for empty progress', () => {
    expect(latestProcessLine('  \n ')).toBe('')
  })

  it('recognizes only explicit task-control phrases', () => {
    expect(isAdvanceTaskCommand('直接下一步')).toBe(true)
    expect(isAdvanceTaskCommand(' 跳过验收，直接下一步！ ')).toBe(true)
    expect(isAdvanceTaskCommand('下一步帮我做海报')).toBe(false)
  })
})
