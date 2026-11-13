import { describe, expect, it } from 'vitest'
import { mentionsKeyTerm, queryKeyTerms, siteSearchQuery } from './siteRelevance'

describe('英文设计博客的题目相关性闸门', () => {
  it('发给站内搜索前去掉 design / inspiration 这类泛词；去完为空就用原词', () => {
    expect(siteSearchQuery('tea packaging design')).toBe('tea packaging')
    expect(siteSearchQuery('Packaging Design Inspiration')).toBe('Packaging')
    expect(siteSearchQuery('design')).toBe('design')
  })

  it('关键词只留非泛词；全是泛词或中文时不设闸门', () => {
    expect(queryKeyTerms('tea packaging design')).toEqual(['tea'])
    expect(queryKeyTerms('Matcha tea box')).toEqual(['matcha', 'tea'])
    expect(queryKeyTerms('packaging design')).toEqual([])
    expect(queryKeyTerms('茶叶包装')).toEqual([])
    expect(mentionsKeyTerm('anything', [])).toBe(true)
  })

  it('整词匹配：Tea & Glory 算，Alec Tear / Teatulia 不算', () => {
    const terms = queryKeyTerms('tea packaging')
    expect(mentionsKeyTerm('Tea & Glory by Socio Design', terms)).toBe(true)
    expect(mentionsKeyTerm('Here’s The Tea: Butterfly Cannon', terms)).toBe(true)
    expect(mentionsKeyTerm('Double Diamond by Alec Tear', terms)).toBe(false)
    expect(mentionsKeyTerm('Teatulia by Here Design', terms)).toBe(false)
    expect(mentionsKeyTerm('Zoetic Organic Teas Packaging Design', terms)).toBe(true)
  })
})
