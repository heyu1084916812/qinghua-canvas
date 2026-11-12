import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import { DESIGN_REFERENCE_SITES } from './designReferenceSites'

/**
 * Bing 逐站补查（2026-11-12 实测后加）：匿名请求下 Bing 常忽略整串 `site:` OR 子句，
 * 按域名过滤后只剩 0–2 条。OR 查询站内命中不足时，对前几个主力站逐站查
 * `<检索词> <站名主干> site:<域名>`——单个 `site:` 更容易被遵守，站名再作关键词偏置一层；
 * 顺序发出、留小间隔、够数即停。抓取与域名过滤仍由 `bingSearch` 负责。
 */
export type BingPageKind = 'web' | 'image'

/** OR 查询的站内命中低于该数时才逐站补查（图片 / 网页分开算）。 */
export const BING_MIN_ON_SITE: Readonly<Record<BingPageKind, number>> = { web: 5, image: 12 }
/** 逐站补查优先的主力站点（按图片 / 网页参考价值排序）。 */
export const BING_PER_SITE_PRIORITY: readonly string[] = [
  'pinterest.com',
  'behance.net',
  'dribbble.com',
  'huaban.com',
  'zcool.com.cn',
]
export const BING_PER_SITE_LIMIT = 4
export const BING_PER_SITE_DELAY_MS = 350
/** 这些失败说明再查也没用（被拦 / 不在桌面 / 断网），逐站补查立即停止。 */
export const BING_PER_SITE_STOP: ReadonlySet<string> = new Set(['captcha', 'rate-limited', 'unavailable', 'network'])

/** 按原图（无图时按页面地址）去重合并。 */
export function mergeBingItems(
  items: DesignResearchItem[],
  seen: Set<string>,
  incoming: readonly DesignResearchItem[],
): void {
  for (const item of incoming) {
    const key = item.imageUrl ? `img:${item.imageUrl}` : `url:${item.url}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
}

/** 逐站补查的站点：优先主力站，且必须在本次允许的域名内；不足时按允许清单顺序补齐。 */
export function bingPerSiteDomains(domains?: readonly string[]): string[] {
  const allowed = domains && domains.length > 0
    ? [...domains]
    : DESIGN_REFERENCE_SITES.map((site) => site.domain)
  const ordered = [
    ...BING_PER_SITE_PRIORITY.filter((domain) => allowed.includes(domain)),
    ...allowed.filter((domain) => !BING_PER_SITE_PRIORITY.includes(domain)),
  ]
  return ordered.slice(0, BING_PER_SITE_LIMIT)
}

/** 单站查询：检索词 + 站名关键词偏置（域名主干，如 pinterest / huaban）+ 单个 `site:`。 */
export function bingPerSiteQuery(query: string, domain: string): string {
  return `${query} ${domain.split('.')[0]} site:${domain}`
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

export interface BingPerSitePassInput {
  kinds: readonly BingPageKind[]
  query: string
  domains?: readonly string[]
  delayMs: number
  signal: AbortSignal
  /** 当前某一类的站内命中数（每次补查后重新计）。 */
  countOf: (kind: BingPageKind) => number
  /** 抓一页并合并结果；返回 true 表示再查也没用（验证码 / 限流 / 非桌面 / 断网），立即停止。 */
  fetchPage: (kind: BingPageKind, query: string, siteIndex: number) => Promise<boolean>
}

/** 对每类不足的结果逐站补查：顺序、间隔、够数即停、可取消。 */
export async function runBingPerSitePass(input: BingPerSitePassInput): Promise<void> {
  const sites = bingPerSiteDomains(input.domains)
  let first = true
  for (const kind of input.kinds) {
    for (const [siteIndex, domain] of sites.entries()) {
      if (input.signal.aborted || input.countOf(kind) >= BING_MIN_ON_SITE[kind]) break
      if (!first) await waitFor(input.delayMs, input.signal)
      first = false
      if (input.signal.aborted) return
      if (await input.fetchPage(kind, bingPerSiteQuery(input.query, domain), siteIndex)) return
    }
  }
}
