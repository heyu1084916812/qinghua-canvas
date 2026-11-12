import { describe, expect, it } from 'vitest'
import {
  AGENT_PHASES,
  agentPhaseCollapsedSummary,
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
