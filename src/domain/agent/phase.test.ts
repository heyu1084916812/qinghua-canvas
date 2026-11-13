import { describe, expect, it } from 'vitest'
import {
  AGENT_PHASES,
  agentPhaseCollapsedSummary,
  agentPhaseFailedTitle,
  agentPhaseStepLine,
  agentPhaseForTool,
  agentPhaseRunningTitle,
  agentPhaseTitle,
  isAgentPhase,
} from './phase'

describe('Agent phase contract', () => {
  it('keeps the phase vocabulary closed and complete', () => {
    expect(AGENT_PHASES).toEqual([
      'understand',
      'align',
      'skillLoaded',
      'research',
      'referenceAnalysis',
      'plan',
      'generate',
      'review',
      'iterate',
      'done',
    ])
    for (const phase of AGENT_PHASES) {
      expect(agentPhaseTitle(phase).length).toBeGreaterThan(0)
    }
  })

  it('rejects unknown phases', () => {
    expect(isAgentPhase('referenceAnalysis')).toBe(true)
    expect(isAgentPhase('thoughtHard')).toBe(false)
    expect(isAgentPhase(null)).toBe(false)
  })

  it('collapses to a factful headline without inventing thinking text', () => {
    expect(agentPhaseCollapsedSummary({
      phase: 'referenceAnalysis',
      title: '参考素材分析结束',
      evidence: ['ref-a', 'ref-b'],
    })).toBe('参考素材分析结束 · 2 项依据')
    expect(agentPhaseCollapsedSummary({
      phase: 'skillLoaded',
      title: '技能加载完成',
    })).toBe('技能加载完成')
  })

  it('maps only known tool evidence to phases', () => {
    expect(agentPhaseForTool('researchDesign')).toBe('research')
    expect(agentPhaseForTool('curateReferences')).toBe('referenceAnalysis')
    expect(agentPhaseForTool('runNode')).toBe('generate')
    expect(agentPhaseForTool('visualReview')).toBe('review')
    expect(agentPhaseForTool('unknownTool')).toBeUndefined()
  })

  it('G-R4：参考分析有进行中 / 结束两段文案，其它阶段没有进行中文案', () => {
    expect(agentPhaseRunningTitle('referenceAnalysis')).toBe('参考素材分析中')
    expect(agentPhaseTitle('referenceAnalysis')).toBe('参考素材分析结束')
    expect(agentPhaseRunningTitle('generate')).toBeUndefined()
  })
})

describe('agentPhaseStepLine（2026-11-12 去重）', () => {
  it('工具标题已含阶段名时只留一行；否则「阶段：工具」', () => {
    expect(agentPhaseStepLine('research', '联网调研完成')).toEqual({ text: '联网调研完成', collapsedSummary: '联网调研完成' })
    expect(agentPhaseStepLine('align', '问题卡已发出')).toEqual({ text: '对齐信息：问题卡已发出', collapsedSummary: '对齐信息' })
  })

  it('#1096：失败时标题与折叠摘要用失败口径，不再显示「调研完成」', () => {
    expect(agentPhaseStepLine('research', '联网调研没完成', true)).toEqual({ text: '联网调研没完成', collapsedSummary: '联网调研没完成' })
    expect(agentPhaseStepLine('align', '问题卡没发出', true)).toEqual({ text: '对齐信息没完成：问题卡没发出', collapsedSummary: '对齐信息没完成' })
    expect(agentPhaseStepLine('generate', '生图（没成功）', true).collapsedSummary).not.toBe('生成完成')
    expect(agentPhaseFailedTitle('research')).toBe('调研没完成')
  })
})
