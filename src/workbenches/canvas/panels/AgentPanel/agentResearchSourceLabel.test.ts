import { describe, expect, it } from 'vitest'
import { agentResearchSourceLabel } from './agentResearchSourceLabel'

describe('agentResearchSourceLabel', () => {
  it('maps open collection providers to readable names', () => {
    expect(agentResearchSourceLabel('internetArchive')).toBe('Internet Archive')
    expect(agentResearchSourceLabel('artic')).toBe('Art Institute')
    expect(agentResearchSourceLabel('cleveland')).toBe('Cleveland Museum')
    expect(agentResearchSourceLabel('met')).toBe('Met Museum')
    expect(agentResearchSourceLabel('openverse')).toBe('Openverse')
    expect(agentResearchSourceLabel('wikipedia')).toBe('Wikipedia')
    expect(agentResearchSourceLabel('bing')).toBe('Bing')
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
})
