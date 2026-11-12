export interface DesignReferenceSite {
  domain: string
  label: string
}

/**
 * 图片 / 风格 / 海报类调研的固定来源。
 *
 * 免 Key 的 Bing 结果页搜索用 `site:` OR 子句限定到这些站点，并在解析后再按域名过滤一次
 * （Bing 对匿名请求偶尔忽略 `site:`）；可选的 Tavily 通道把它们作为 `include_domains`。
 * 目的是避免通用搜索把结果带到低质量聚合页、登录墙或与视觉参考无关的内容。
 */
export const DESIGN_REFERENCE_SITES: readonly DesignReferenceSite[] = [
  { domain: 'pinterest.com', label: 'Pinterest' },
  { domain: 'behance.net', label: 'Behance' },
  { domain: 'dribbble.com', label: 'Dribbble' },
  { domain: 'are.na', label: 'Are.na' },
  { domain: 'thedieline.com', label: 'The Dieline' },
  { domain: 'packagingoftheworld.com', label: 'Packaging of the World' },
  { domain: 'worldbranddesign.com', label: 'World Brand Design Society' },
  { domain: 'pentawards.com', label: 'Pentawards' },
  { domain: 'zcool.com.cn', label: '站酷' },
  { domain: 'gtn9.com', label: '古田路9号' },
  { domain: 'huaban.com', label: '花瓣' },
  { domain: 'xiaohongshu.com', label: '小红书' },
] as const

export const DESIGN_REFERENCE_DOMAINS: readonly string[] =
  DESIGN_REFERENCE_SITES.map((site) => site.domain)

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** URL 是否落在固定设计站点：含子域（如 `cn.pinterest.com`）；图床域名（如 `i.pinimg.com`）不算。 */
export function isDesignReferenceUrl(url: string): boolean {
  const host = hostOf(url)
  return Boolean(host) && DESIGN_REFERENCE_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  )
}

/** Bing 查询用的站点限定：`(site:a OR site:b …)`。 */
export function designReferenceSiteQuery(
  domains: readonly string[] = DESIGN_REFERENCE_DOMAINS,
): string {
  return `(${domains.map((domain) => `site:${domain}`).join(' OR ')})`
}

export function designReferenceSiteLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    return (
      DESIGN_REFERENCE_SITES.find(
        (site) => host === site.domain || host.endsWith(`.${site.domain}`),
      )?.label ?? host
    )
  } catch {
    return ''
  }
}
