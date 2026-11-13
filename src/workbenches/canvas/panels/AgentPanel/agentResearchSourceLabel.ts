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
  if (normalized === 'huaban') return '花瓣'
  if (normalized === 'zcool') return '站酷'
  if (normalized === 'dribbble') return 'Dribbble'
  if (normalized === 'thedieline') return 'The Dieline'
  if (normalized === 'packagingoftheworld') return 'Packaging of the World'
  if (normalized === 'cosmos') return 'Cosmos'
  if (normalized === 'bpando') return 'BP&O'
  if (normalized === 'lovelypackage') return 'Lovely Package'
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

/** 结果覆盖多少个来源网站（按来源页主机名去重，图文都算）；工具没回 sources 时用它兜底。 */
export function researchSourceHostCount(items: readonly { url: string }[]): number {
  const hosts = new Set<string>()
  for (const item of items) {
    try {
      hosts.add(new URL(item.url).hostname.replace(/^www\./, ''))
    } catch {
      /* 已在解析时校验为公开地址 */
    }
  }
  return hosts.size
}

/** 网页 / 混合调研的「N 个网页」：可打开的来源页数（按地址去重，原图地址不算网页）。 */
export function researchWebPageCount(items: readonly { url: string; imageUrl: string }[]): number {
  return new Set(items.filter((item) => item.url && item.url !== item.imageUrl).map((item) => item.url)).size
}

/**
 * 调研步骤标题（#1076）：写明实际用到的来源再接「N 个网页」，如「花瓣 · 站酷 · 2 个网页」。
 * 旧结果没有 `usedSources` 时只显示「N 个网页」；来源去重、最多 4 个。
 */
export function researchStepLabel(usedSources: unknown, pageCount: number): string {
  const names = Array.isArray(usedSources)
    ? [...new Set(usedSources.map((name) => String(name ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 4)
    : []
  return `${names.length > 0 ? `${names.join(' · ')} · ` : ''}${pageCount} 个网页`
}
