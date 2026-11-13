import { DESIGN_REFERENCE_SITES } from '../../../features/shared/research/designReferenceSites'

/**
 * 画布浏览器起始页的快捷入口（2026-11-13）。
 *
 * 名称与域名取自调研的固定来源 `DESIGN_REFERENCE_SITES`，保证「浏览器里点开的站」与
 * 「Agent 调研限定的站」是同一份名单；这里只挑六个、给出落地页（首页或图片频道）。
 * Behance 不放：#1076 实测连真实浏览器都 403。
 */
export interface BrowserQuickSite {
  domain: string
  label: string
  url: string
  /** 磁贴上的单字徽记（不去远端拉 favicon：离线可用、也不泄露浏览记录） */
  mark: string
}

const PICKS: ReadonlyArray<{ domain: string; url: string; mark: string }> = [
  { domain: 'dribbble.com', url: 'https://dribbble.com/shots/popular', mark: 'D' },
  { domain: 'pinterest.com', url: 'https://www.pinterest.com/', mark: 'P' },
  { domain: 'thedieline.com', url: 'https://thedieline.com/', mark: 'TD' },
  { domain: 'packagingoftheworld.com', url: 'https://www.packagingoftheworld.com/', mark: 'PW' },
  { domain: 'huaban.com', url: 'https://huaban.com/', mark: '花' },
  { domain: 'zcool.com.cn', url: 'https://www.zcool.com.cn/', mark: '站' },
]

export const BROWSER_QUICK_SITES: readonly BrowserQuickSite[] = PICKS.flatMap((pick) => {
  const site = DESIGN_REFERENCE_SITES.find((item) => item.domain === pick.domain)
  return site ? [{ domain: site.domain, label: site.label, url: pick.url, mark: pick.mark }] : []
})
