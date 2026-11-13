import { describe, expect, it } from 'vitest'
import {
  DESIGN_REFERENCE_DOMAINS,
  DESIGN_REFERENCE_SITES,
  designReferenceSiteLabel,
  designReferenceSiteQuery,
  isDesignReferenceUrl,
} from './designReferenceSites'

describe('designReferenceSites', () => {
  it('keeps the fixed image and style research sources in product order', () => {
    expect(DESIGN_REFERENCE_DOMAINS).toEqual([
      'pinterest.com',
      'behance.net',
      'dribbble.com',
      'are.na',
      'thedieline.com',
      'packagingoftheworld.com',
      'worldbranddesign.com',
      'pentawards.com',
      'zcool.com.cn',
      'gtn9.com',
      'huaban.com',
      'xiaohongshu.com',
      'cosmos.so',
      'bpando.org',
      'lovelypackage.com',
    ])
    expect(DESIGN_REFERENCE_SITES.map((site) => site.label)).toContain('古田路9号')
  })

  it('matches subdomains without confusing unrelated hosts', () => {
    expect(designReferenceSiteLabel('https://www.pinterest.com/pin/1')).toBe('Pinterest')
    expect(designReferenceSiteLabel('https://gallery.behance.net/x')).toBe('Behance')
    expect(designReferenceSiteLabel('https://notpinterest.com/x')).toBe('notpinterest.com')
  })

  it('filters result URLs to the fixed sites, including subdomains', () => {
    expect(isDesignReferenceUrl('https://id.pinterest.com/pin/445856431851923588/')).toBe(true)
    expect(isDesignReferenceUrl('https://www.zcool.com.cn/work/abc.html')).toBe(true)
    expect(isDesignReferenceUrl('https://i.pinimg.com/originals/a.jpg')).toBe(false)
    expect(isDesignReferenceUrl('https://notpinterest.com/x')).toBe(false)
    expect(isDesignReferenceUrl('not a url')).toBe(false)
  })

  it('builds one site: OR clause for Bing over all fixed sites', () => {
    const clause = designReferenceSiteQuery()
    expect(clause.startsWith('(site:pinterest.com OR site:behance.net')).toBe(true)
    expect(clause.endsWith('site:lovelypackage.com)')).toBe(true)
    expect(clause.match(/site:/g)).toHaveLength(15)
    expect(designReferenceSiteQuery(['a.com', 'b.com'])).toBe('(site:a.com OR site:b.com)')
  })
})
