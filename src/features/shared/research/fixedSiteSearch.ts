import type { DesignResearchItem, ResearchMode } from '../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../platform/ports'
import { searchBing } from './bingSearch'
import { searchTavily } from './tavilySearch'

/**
 * 固定 12 个设计站的联网搜索调度（2026-11-12）：
 *
 * 1. 默认走免 Key 的 Bing 结果页（`searchBing`）；
 * 2. 只有免费通道**没拿到任何可用结果**（验证码 / 限流 / 解析为空 / 连不上）且用户填了
 *    Tavily Key 时，才调用 Tavily（省额度，也不让两路结果混排）；
 * 3. 两路都没有结果时如实给出原因；没填 Key 只是提示“可选”，不再当成必须处理的错误。
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
}

export interface FixedSiteSearchResult {
  items: DesignResearchItem[]
  warnings: string[]
  /** 走到了 Tavily 且 Key 被拒 / 额度用尽。 */
  needsTavilyKey: boolean
  /** 实际产出结果的通道；都失败时为 `none`。 */
  via: 'bing' | 'tavily' | 'none'
}

export async function searchFixedDesignSites(
  deps: FixedSiteSearchDeps,
  input: FixedSiteSearchInput,
  signal: AbortSignal,
): Promise<FixedSiteSearchResult> {
  const free = await searchBing(
    deps.network,
    { queries: input.queries, ...(input.mode ? { mode: input.mode } : {}) },
    signal,
  )
  if (free.items.length > 0) {
    return { items: free.items, warnings: [], needsTavilyKey: false, via: 'bing' }
  }
  const freeReason = free.failureText ?? '免费搜索没有找到结果'
  const apiKey = (deps.tavilyApiKey ?? '').trim()
  if (!apiKey || signal.aborted) {
    return {
      items: [],
      warnings: [`${freeReason}。${TAVILY_OPTIONAL_HINT}`],
      needsTavilyKey: false,
      via: 'none',
    }
  }
  const tavily = await searchTavily(
    deps.network,
    {
      apiKey,
      queries: input.queries,
      maxResults: input.maxResults,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.imageMaxResults ? { imageMaxResults: input.imageMaxResults } : {}),
    },
    signal,
  )
  const switched = `${freeReason}，已改用 Tavily 备用搜索。`
  return {
    items: tavily.items,
    warnings: [switched, ...tavily.warnings],
    needsTavilyKey: tavily.needsKey === true,
    via: tavily.items.length > 0 ? 'tavily' : 'none',
  }
}
