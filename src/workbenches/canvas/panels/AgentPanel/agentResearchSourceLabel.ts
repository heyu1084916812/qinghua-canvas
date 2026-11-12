import { designReferenceSiteLabel } from '../../../../features/shared/research/designReferenceSites'

export function agentResearchSourceLabel(source: string, url = ''): string {
  const siteLabel = url ? designReferenceSiteLabel(url) : ''
  if (siteLabel) return siteLabel
  const normalized = source.trim().toLowerCase()
  if (normalized === 'internetarchive') return 'Internet Archive'
  if (normalized === 'artic') return 'Art Institute'
  if (normalized === 'cleveland') return 'Cleveland Museum'
  if (normalized === 'met') return 'Met Museum'
  if (normalized === 'searxng') return 'SearXNG'
  if (normalized === 'tavily') return 'Tavily'
  if (normalized === 'bing') return 'Bing'
  if (normalized === 'openverse') return 'Openverse'
  if (normalized === 'wikipedia') return 'Wikipedia'
  if (normalized === 'pinterest') return 'Pinterest'
  if (normalized === 'behance') return 'Behance'
  return source
}

/** 图片调研的「N 个网页」：结果图来自多少个不同的来源网站（按来源页主机名去重）。 */
export function researchSiteCount(items: readonly { url: string; imageUrl: string }[]): number {
  const hosts = new Set<string>()
  for (const item of items) {
    if (!item.imageUrl) continue
    try {
      hosts.add(new URL(item.url).hostname.replace(/^www\./, ''))
    } catch {
      /* 已在解析时校验为公开地址 */
    }
  }
  return hosts.size
}
