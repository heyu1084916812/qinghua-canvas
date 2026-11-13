import { describe, expect, it } from 'vitest'
import { normalizeBrowserAddress } from '../../../domain/canvas/browserAddress'
import { isDesignReferenceUrl } from '../../../features/shared/research/designReferenceSites'
import { BROWSER_QUICK_SITES } from './browserQuickSites'

describe('BROWSER_QUICK_SITES', () => {
  it('lists the six design sites from the shared research list', () => {
    expect(BROWSER_QUICK_SITES.map((site) => site.label)).toEqual([
      'Dribbble',
      'Pinterest',
      'The Dieline',
      'Packaging of the World',
      '花瓣',
      '站酷',
    ])
  })

  it('every entry is a public https design-reference URL', () => {
    for (const site of BROWSER_QUICK_SITES) {
      expect(normalizeBrowserAddress(site.url)).toEqual({ ok: true, url: site.url })
      expect(isDesignReferenceUrl(site.url)).toBe(true)
      expect(site.mark.length).toBeGreaterThan(0)
    }
  })
})
