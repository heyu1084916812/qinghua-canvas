import { describe, expect, it } from 'vitest'
import {
  DESIGN_REFERENCE_DOMAINS,
  DESIGN_REFERENCE_SITES,
  designReferenceSiteLabel,
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
    ])
    expect(DESIGN_REFERENCE_SITES.map((site) => site.label)).toContain('古田路9号')
  })

  it('matches subdomains without confusing unrelated hosts', () => {
    expect(designReferenceSiteLabel('https://www.pinterest.com/pin/1')).toBe('Pinterest')
    expect(designReferenceSiteLabel('https://gallery.behance.net/x')).toBe('Behance')
    expect(designReferenceSiteLabel('https://notpinterest.com/x')).toBe('notpinterest.com')
  })
})
