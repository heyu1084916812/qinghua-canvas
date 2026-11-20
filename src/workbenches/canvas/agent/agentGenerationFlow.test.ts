import { describe, expect, it } from 'vitest'
import { agentGenerationFlowLabel, classifyAgentGenerationFlow } from './agentGenerationFlow'

const base = { requestMode: 'simple_generate' as const, hasReference: false, hasKit: false, continued: false, hasTaskPlan: false }
describe('Agent six generation flows', () => {
  it.each([
    ['画一张海报', 'direct'],
    ['用这张参考图改成竖版', 'reference'],
    ['用品牌套件做同系列横版', 'brandSeries'],
    ['联网搜一下包装案例', 'research'],
    ['再来一张，保持主体不变', 'iterate'],
    ['做一整套详情页和系列海报', 'suite'],
  ] as const)('classifies %s as %s', (text, expected) => {
    expect(classifyAgentGenerationFlow({ ...base, text, hasReference: text.includes('参考'), hasKit: text.includes('品牌') })).toBe(expected)
  })
  it('keeps the priority order explicit and does not invent brand series without a kit', () => {
    expect(classifyAgentGenerationFlow({ ...base, text: '联网搜一下品牌套件同系列方案', requestMode: 'design_research', hasKit: true })).toBe('research')
    expect(classifyAgentGenerationFlow({ ...base, text: '把这张参考图再改亮一点', hasReference: true })).toBe('reference')
    expect(classifyAgentGenerationFlow({ ...base, text: '做同系列横版', hasKit: false })).toBe('direct')
    expect(classifyAgentGenerationFlow({ ...base, text: '做同系列横版', hasKit: true })).toBe('brandSeries')
    expect(classifyAgentGenerationFlow({ ...base, text: '继续做下一张', continued: true })).toBe('iterate')
  })
  it('exposes stable user-facing labels', () => {
    expect(agentGenerationFlowLabel('suite')).toBe('长流程套装交付')
  })
})
