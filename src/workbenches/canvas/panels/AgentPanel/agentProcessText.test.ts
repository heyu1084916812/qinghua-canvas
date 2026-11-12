import { describe, expect, it } from 'vitest'
import {
  collapsedProcessHeadline,
  expandedProcessView,
  isAdvanceTaskCommand,
  latestProcessLine,
} from './agentProcessText'

describe('agent process headline', () => {
  it('2026-11-12：泛阶段「对齐信息」不抢折叠标题，显示参考分析 / 调研这类具体阶段', () => {
    expect(collapsedProcessHeadline([
      { id: 'a', text: '参考分析未完成', phase: 'referenceAnalysis', collapsedSummary: '参考素材分析结束' },
      { id: 'b', text: '对齐信息：问题卡已发出', phase: 'align', collapsedSummary: '对齐信息' },
    ], '')).toBe('参考素材分析结束')
    expect(collapsedProcessHeadline([
      { id: 'b', text: '对齐信息：已看画布', phase: 'align', collapsedSummary: '对齐信息' },
    ], '')).toBe('对齐信息')
  })

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

  it('uses the latest completed phase as the collapsed headline', () => {
    expect(collapsedProcessHeadline([
      { id: 'a', text: '正在找参考', source: 'intent' },
      {
        id: 'b',
        text: '调研完成：设计调研完成',
        phase: 'research',
        collapsedSummary: '调研完成 · 2 项依据',
      },
    ], '忽略这段实时过程')).toBe('调研完成 · 2 项依据')
  })

  it('falls back to the latest process line without phase events', () => {
    expect(collapsedProcessHeadline(
      [{ id: 'a', text: '先检查画布。', source: 'intent' }],
      '先检查画布。最后准备生成。',
    )).toBe('最后准备生成。')
  })

  it('★★ 展开区实时文本与最新历史重复时只保留一份', () => {
    const history = [
      { id: 'old', text: '先检查画布。' },
      { id: 'latest', text: '准备调用 readCapabilities' },
    ]

    expect(
      expandedProcessView(history, '准备调用 readCapabilities'),
    ).toEqual({
      liveText: '准备调用 readCapabilities',
      rows: [{ id: 'old', text: '先检查画布。' }],
    })
  })

  it('★ 实时文本是历史帧的续写时，用最新实时文本替换旧帧', () => {
    const history = [{ id: 'latest', text: '准备调用' }]

    expect(
      expandedProcessView(history, '准备调用 readCapabilities'),
    ).toEqual({
      liveText: '准备调用 readCapabilities',
      rows: [],
    })
  })

  it('★ 历史已经领先于实时文本时不显示过期实时正文', () => {
    const history = [
      { id: 'latest', text: '准备调用 readCapabilities 查能力' },
    ]

    expect(
      expandedProcessView(history, '准备调用 readCapabilities'),
    ).toEqual({
      liveText: '',
      rows: history,
    })
  })
})
