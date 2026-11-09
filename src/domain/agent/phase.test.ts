import { describe, expect, it } from 'vitest'
import {
  AGENT_PHASES,
  agentPhaseCollapsedSummary,
  agentPhaseForTool,
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
      title: '参考分析完成',
      evidence: ['ref-a', 'ref-b'],
    })).toBe('参考分析完成 · 2 项依据')
    expect(agentPhaseCollapsedSummary({
      phase: 'skillLoaded',
      title: '技能加载完成',
    })).toBe('技能加载完成')
  })

  it('maps only known tool evidence to phases', () => {
    expect(agentPhaseForTool('researchDesign')).toBe('research')
    expect(agentPhaseForTool('runNode')).toBe('generate')
    expect(agentPhaseForTool('visualReview')).toBe('review')
    expect(agentPhaseForTool('unknownTool')).toBeUndefined()
  })
})
