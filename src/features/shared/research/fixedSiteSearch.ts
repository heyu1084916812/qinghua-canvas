import type { DesignResearchItem, ResearchMode } from '../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../platform/ports'
import { searchBing } from './bingSearch'
import { runSiteAdapters, type SiteAdapterRunStatus } from './siteAdapters/runSiteAdapters'
import { searchTavily } from './tavilySearch'

/**
 * 固定设计站的联网搜索调度（#1076 方案 D，2026-11-13 改）：
 *
 * - **图片**：直连站点适配器（花瓣 + 站酷，`siteAdapters/`）→ 浏览器站点（Dribbble / Dieline /
 *   POTW / Pinterest）目前只记 `needs-browser` → 适配器**一张都没拿到**且填了 Tavily Key 时改用 Tavily。
 *   **不再用 Bing 图片搜索**：Bing 图片接口在 `site:` 子句下不理查询词，只按域名过滤会把站内无关图当成功。
 * - **网页**：免 Key 的 Bing 网页结果页（相关性实测正常）→ 没有结果且填了 Key 时改用 Tavily。
 * - **图文混合**：两路并发；适配器没有图片、或两路都空时，才调用 Tavily。
 * - 不回退 Openverse / Wikipedia 等非指定来源（#1029 用户口径）。
 */
export const TAVILY_OPTIONAL_HINT =
  '可以稍后再试、换个角度或英文关键词；也可以在 设置 → Agent → 工具 → 联网调研 填写 Tavily API Key 作为备用搜索（可选）。'

export interface FixedSiteSearchInput {
  queries: readonly string[]
  maxResults: number
  mode?: ResearchMode
  imageMaxResults?: number
}

export interface FixedSiteSearchDeps {
  network: NetworkPort
  tavilyApiKey?: string | null
  /** 站点适配器同站相邻请求间隔；缺省 400ms，测试传 0。 */
  siteAdapterDelayMs?: number
}

export interface FixedSiteSearchResult {
  items: DesignResearchItem[]
  warnings: string[]
  /** 走到了 Tavily 且 Key 被拒 / 额度用尽。 */
  needsTavilyKey: boolean
  /** 主要产出结果的通道；都失败时为 `none`。 */
  via: 'sites' | 'bing' | 'tavily' | 'none'
  /** 实际产出结果的来源名（如 `['花瓣', '站酷']`、`['Bing']`、`['Tavily']`），给步骤标签与提示词用。 */
  usedSources: string[]
  /** 图片 / 混合模式下各设计站的检索状态（含 `needs-browser`）；网页模式为空。 */
  siteStatuses: SiteAdapterRunStatus[]
}

const DEFAULT_IMAGE_TARGET = 40

async function tavilyFallback(
  deps: FixedSiteSearchDeps,
  input: FixedSiteSearchInput,
  mode: ResearchMode,
  reason: string,
  signal: AbortSignal,
): Promise<{ items: DesignResearchItem[]; warnings: string[]; needsKey: boolean; tried: boolean }> {
  const apiKey = (deps.tavilyApiKey ?? '').trim()
  if (!apiKey || signal.aborted) {
    return { items: [], warnings: [`${reason}。${TAVILY_OPTIONAL_HINT}`], needsKey: false, tried: false }
  }
  const tavily = await searchTavily(
    deps.network,
    {
      apiKey,
      queries: input.queries,
      maxResults: input.maxResults,
      mode,
      ...(input.imageMaxResults ? { imageMaxResults: input.imageMaxResults } : {}),
    },
    signal,
  )
  return {
    items: tavily.items,
    warnings: [`${reason}，已改用 Tavily 备用搜索。`, ...tavily.warnings],
    needsKey: tavily.needsKey === true,
    tried: true,
  }
}

export async function searchFixedDesignSites(
  deps: FixedSiteSearchDeps,
  input: FixedSiteSearchInput,
  signal: AbortSignal,
): Promise<FixedSiteSearchResult> {
  const mode: ResearchMode = input.mode ?? 'image'
  const wantImages = mode !== 'web'
  const wantWeb = mode !== 'image'
  const [sites, bing] = await Promise.all([
    wantImages
      ? runSiteAdapters(
          deps.network,
          {
            queries: input.queries,
            imageMaxResults: input.imageMaxResults ?? DEFAULT_IMAGE_TARGET,
            ...(deps.siteAdapterDelayMs !== undefined ? { delayMs: deps.siteAdapterDelayMs } : {}),
          },
          signal,
        )
      : null,
    wantWeb ? searchBing(deps.network, { queries: input.queries, mode: 'web' }, signal) : null,
  ])
  const siteItems = sites?.items ?? []
  const webItems = bing?.items ?? []
  const items = [...siteItems, ...webItems]
  const usedSources = [...(sites?.usedSources ?? []), ...(webItems.length > 0 ? ['Bing'] : [])]
  const siteStatuses = sites?.statuses ?? []

  // 图片要的却一张没有（或网页模式网页为空）⇒ 才轮到 Tavily；有结果就不花额度。
  const missingImages = wantImages && siteItems.length === 0
  const missingAll = items.length === 0
  if (!missingImages && !missingAll) {
    return { items, warnings: [], needsTavilyKey: false, via: siteItems.length > 0 ? 'sites' : 'bing', usedSources, siteStatuses }
  }
  const reasons = [
    ...(missingImages ? sites?.failures ?? [] : []),
    ...(wantWeb && webItems.length === 0 ? [bing?.failureText ?? '网页搜索没有找到结果'] : []),
  ]
  const reason = reasons.length > 0 ? reasons.join('；') : '设计站点没有找到结果'
  const fallback = await tavilyFallback(deps, input, missingAll ? mode : 'image', reason, signal)
  const merged = [...items, ...fallback.items]
  return {
    items: merged,
    warnings: fallback.warnings,
    needsTavilyKey: fallback.needsKey,
    via: fallback.items.length > 0 && items.length === 0 ? 'tavily' : items.length > 0 ? (siteItems.length > 0 ? 'sites' : 'bing') : 'none',
    usedSources: [...usedSources, ...(fallback.items.length > 0 ? ['Tavily'] : [])],
    siteStatuses,
  }
}
