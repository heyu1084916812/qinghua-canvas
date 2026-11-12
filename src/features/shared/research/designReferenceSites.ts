export interface DesignReferenceSite {
  domain: string
  label: string
}

/**
 * 图片 / 风格 / 海报类调研的固定来源。
 *
 * 这些站点直接作为 Tavily `include_domains` 使用，避免通用搜索把结果带到
 * 低质量聚合页、登录墙或与视觉参考无关的内容。用户可在后续版本再开放自定义。
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
