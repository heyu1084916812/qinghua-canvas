import { describe, expect, it } from 'vitest'
import { agentResearchSourceLabel, researchStepLabel } from './agentResearchSourceLabel'

describe('agentResearchSourceLabel', () => {
  it('maps open collection providers to readable names', () => {
    expect(agentResearchSourceLabel('internetArchive')).toBe('Internet Archive')
    expect(agentResearchSourceLabel('artic')).toBe('Art Institute')
    expect(agentResearchSourceLabel('cleveland')).toBe('Cleveland Museum')
    expect(agentResearchSourceLabel('met')).toBe('Met Museum')
    expect(agentResearchSourceLabel('openverse')).toBe('Openverse')
    expect(agentResearchSourceLabel('wikipedia')).toBe('Wikipedia')
    expect(agentResearchSourceLabel('bing')).toBe('Bing')
    expect(agentResearchSourceLabel('huaban')).toBe('花瓣')
    expect(agentResearchSourceLabel('zcool')).toBe('站酷')
  })

  it('names the agent-browser design sites (#1087)', () => {
    expect(['dribbble', 'thedieline', 'packagingoftheworld'].map((source) => agentResearchSourceLabel(source)))
      .toEqual(['Dribbble', 'The Dieline', 'Packaging of the World'])
    expect(['cosmos', 'bpando', 'lovelypackage'].map((source) => agentResearchSourceLabel(source)))
      .toEqual(['Cosmos', 'BP&O', 'Lovely Package'])
    expect(agentResearchSourceLabel('web', 'https://www.cosmos.so/e/1')).toBe('Cosmos')
  })

  it('keeps unknown sources unchanged instead of inventing a provider', () => {
    expect(agentResearchSourceLabel('custom-source')).toBe('custom-source')
  })

  it('prefers the fixed design site name when the result URL belongs to it', () => {
    expect(
      agentResearchSourceLabel('tavily', 'https://www.behance.net/gallery/123/poster'),
    ).toBe('Behance')
    expect(
      agentResearchSourceLabel('tavily', 'https://www.packagingoftheworld.com/2026/01/box.html'),
    ).toBe('Packaging of the World')
  })

  it('#1076：步骤标题前缀实际来源，去重且最多 4 个；没有来源时只显示网页数', () => {
    expect(researchStepLabel(['花瓣', '站酷', '花瓣'], 2)).toBe('花瓣 · 站酷 · 2 个网页')
    expect(researchStepLabel(['a', 'b', 'c', 'd', 'e'], 1)).toBe('a · b · c · d · 1 个网页')
    expect(researchStepLabel(undefined, 3)).toBe('3 个网页')
    expect(researchStepLabel(['', '  '], 3)).toBe('3 个网页')
  })
})
