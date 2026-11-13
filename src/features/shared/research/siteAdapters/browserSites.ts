import type { DesignResearchItem, ResearchProvider } from '../../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import type { PageExtractOptions, PageSnapshot, PageSnapshotImage } from './pageSnapshot'
import { plainTitle } from './siteFetch'
import type { SiteAdapterId } from './types'

/**
 * 浏览器专用设计站的「搜索地址模板 + 提取规则」（对账 #1087，2026-11-13）。
 *
 * 选择器按 2026-11-13 真实 Chromium 渲染后的 DOM 写（fixtures 目录有裁剪后的实录）：
 * - **Dribbble**：结果卡 `li#screenshot-<id>.shot-thumbnail`，图在 `figure img[srcset]`
 *   （`cdn.dribbble.com/userupload/…?resize=…`），原帖链接是**兄弟节点** `a.shot-thumbnail-link`
 *   （`/shots/<id>-<slug>`），标题在 `.shot-title`。
 * - **The Dieline**：WordPress 区块 `li.wp-block-post`，`figure.wp-block-post-featured-image a > img`
 *   （srcset 走 `i0.wp.com/thedieline.com/wp-content/uploads/…`），标题 `.wp-block-post-title a`。
 * - **Packaging of the World**：`.project-card` 里缩略图是 **CSS 背景图** `a.thumb[data-bg]`
 *   （`i0.wp.com/packagingoftheworld.com/wp-content/uploads/…`），标题 `h5.project-title a`。
 * - **Pinterest**：`[data-grid-item]` 里 `img[srcset]`（`i.pinimg.com/236x|474x|736x|originals`），
 *   登录后有 `a[href*="/pin/"]`；未登录是 `[data-test-id="gated-pin-rep"]` 且弹登录框（密码框）。
 */
export interface BrowserSiteSpec {
  id: Extract<SiteAdapterId, 'dribbble' | 'thedieline' | 'packagingoftheworld' | 'pinterest'>
  provider: ResearchProvider
  label: string
  domain: string
  searchUrl: (query: string) => string
  extract: Partial<PageExtractOptions>
  /** 图片地址必须命中（挡掉头像、广告、站点图标）。 */
  imagePattern: RegExp
  /** 原帖链接必须命中；不命中时链接退回搜索页（`requireLink` 时直接丢掉这张）。 */
  linkPattern: RegExp
  /** 没有原帖链接的图不要（挡掉推荐位 / 横幅等非结果图）。 */
  requireLink?: boolean
  /** 结果卡被「门」挡住即视为登录墙（Pinterest）。 */
  gatedMeansLogin?: boolean
  /** 往下滚几屏。 */
  scrollSteps?: number
}

export const BROWSER_SITE_SPECS: readonly BrowserSiteSpec[] = [
  {
    id: 'dribbble',
    provider: 'dribbble',
    label: 'Dribbble',
    domain: 'dribbble.com',
    // Dribbble 的搜索地址是 `/search/<连字符词>`（空格换成 `-`）
    searchUrl: (query) => `https://dribbble.com/search/${encodeURIComponent(query.trim().replace(/\s+/g, '-'))}`,
    extract: {
      cardSelector: '[id^="screenshot-"]',
      linkSelector: 'a.shot-thumbnail-link, a[href*="/shots/"]',
      titleSelector: '.shot-title',
      preferWidth: 800,
    },
    imagePattern: /^https:\/\/cdn\.dribbble\.com\/userupload\//i,
    linkPattern: /^https:\/\/dribbble\.com\/shots\/\d+/i,
    requireLink: true,
  },
  {
    id: 'thedieline',
    provider: 'thedieline',
    label: 'The Dieline',
    domain: 'thedieline.com',
    // `/?s=` 会 301 到 `/search/<词>`，两种都可用；用查询串免得自己转义路径
    searchUrl: (query) => `https://thedieline.com/?s=${encodeURIComponent(query.trim())}`,
    extract: {
      cardSelector: 'li.wp-block-post',
      linkSelector: '.wp-block-post-title a, figure a[href]',
      titleSelector: '.wp-block-post-title',
      preferWidth: 1000,
    },
    imagePattern: /^https:\/\/(?:i\d\.wp\.com\/)?thedieline\.com\/wp-content\/uploads\//i,
    linkPattern: /^https:\/\/thedieline\.com\/[^?#]+/i,
    requireLink: true,
  },
  {
    id: 'packagingoftheworld',
    provider: 'packagingoftheworld',
    label: 'Packaging of the World',
    domain: 'packagingoftheworld.com',
    searchUrl: (query) => `https://packagingoftheworld.com/?s=${encodeURIComponent(query.trim())}`,
    extract: {
      cardSelector: '.project-card',
      linkSelector: 'h5 a[href$=".html"], a.thumb[href]',
      titleSelector: '.project-title',
      backgroundSelector: '.project-card a.thumb',
    },
    imagePattern: /^https:\/\/(?:i\d\.wp\.com\/)?packagingoftheworld\.com\/wp-content\/uploads\//i,
    linkPattern: /^https:\/\/packagingoftheworld\.com\/\d{4}\/\d{2}\/[^?#]+\.html/i,
    requireLink: true,
  },
  {
    id: 'pinterest',
    provider: 'pinterest',
    label: 'Pinterest',
    domain: 'pinterest.com',
    searchUrl: (query) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query.trim())}`,
    extract: {
      cardSelector: '[data-grid-item]',
      linkSelector: 'a[href*="/pin/"]',
      gateSelector: '[data-test-id="gated-pin-rep"]',
      preferDensity: 3,
    },
    imagePattern: /^https:\/\/i\.pinimg\.com\/(?:\d+x|originals)\//i,
    linkPattern: /^https:\/\/(?:[a-z]{2,3}\.|www\.)?pinterest\.[a-z.]+\/pin\/\d+/i,
    gatedMeansLogin: true,
    scrollSteps: 2,
  },
]

export function browserSiteSpec(id: SiteAdapterId): BrowserSiteSpec | undefined {
  return BROWSER_SITE_SPECS.find((spec) => spec.id === id)
}

/** 稳定短哈希（id 用，不求密码学强度）。 */
function shortHash(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

/** Pinterest / Dribbble 的 alt 常带一串标签：只留前一段作标题。 */
function titleOf(image: PageSnapshotImage, fallback: string): string {
  const title = plainTitle(image.title) || plainTitle(image.alt)
  if (!title || /^pin$/i.test(title)) return fallback
  return title.length > 80 ? `${title.slice(0, 80).trim()}…` : title
}

/**
 * 快照 → 调研候选（与花瓣 / 站酷同一结构，直接进现有调研画廊）。
 * 只收命中站点图床的图；原帖链接不合规时退回搜索页（仍可点回站内）。
 */
export function browserSiteItems(
  spec: BrowserSiteSpec,
  snapshot: PageSnapshot,
  options: { queryIndex: number; searchUrl: string; limit: number },
): DesignResearchItem[] {
  const items: DesignResearchItem[] = []
  const seen = new Set<string>()
  for (const image of snapshot.images) {
    if (items.length >= options.limit) break
    if (!spec.imagePattern.test(image.src) || !isPublicHttpUrl(image.src)) continue
    if (seen.has(image.src)) continue
    seen.add(image.src)
    const linked = spec.linkPattern.test(image.link) && isPublicHttpUrl(image.link)
    if (spec.requireLink && !linked) continue
    const link = linked ? image.link : options.searchUrl
    const size = image.width > 0 && image.height > 0 ? `${image.width}×${image.height}` : ''
    const fallbacks = image.display && image.display !== image.src && spec.imagePattern.test(image.display)
      ? [image.display]
      : []
    items.push({
      id: `${spec.id}:${options.queryIndex}:${shortHash(image.src)}`,
      source: spec.provider,
      title: titleOf(image, `${spec.label} 作品`),
      url: link,
      imageUrl: image.src,
      ...(fallbacks.length > 0 ? { imageUrls: fallbacks } : {}),
      description: [spec.label, size].filter(Boolean).join(' · '),
    })
  }
  return items
}
