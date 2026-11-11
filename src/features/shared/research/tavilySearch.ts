import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../platform/ports'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import { asAppError } from '../../../shared/result'

/**
 * Tavily 通用网页 + 图片搜索（用户 2026-11-11 拍板的内置联网来源）。
 *
 * 字段只认官方文档 https://docs.tavily.com/documentation/api-reference/endpoint/search
 * 列出的：请求 `query / max_results / search_depth / include_images /
 * include_image_descriptions / include_answer`；响应 `results[{title,url,content,score,images?}]`
 * 与顶层 `images[{url,title?,description}]`（未开 description 时也可能是字符串数组）。
 *
 * Key 只出现在 Authorization 头里：不进日志、不进错误文案、不进工具结果。
 */
export const TAVILY_SEARCH_ENDPOINT = 'https://api.tavily.com/search'
/** 凭据端口里的引用名；值由用户在 设置 → Agent → 工具 → 联网调研 填写。 */
export const TAVILY_API_KEY_REF = 'research:tavily:api-key'
/** Tavily `max_results` 官方上限。 */
const TAVILY_MAX_RESULTS = 20

export const TAVILY_KEY_MISSING_MESSAGE =
  '联网搜索需要 Tavily API Key：请到 设置 → Agent → 工具 → 联网调研 填写（免费额度每月 1000 次）。' +
  '在此之前只能读取你直接给出的网页链接。'

export interface TavilySearchResult {
  items: DesignResearchItem[]
  warnings: string[]
  /** Key 缺失、无效或额度用尽：需要用户去设置里处理。 */
  needsKey?: boolean
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanText(value: string, limit = 400): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

interface TavilyImage {
  url: string
  description: string
}

function imagesOf(value: unknown): TavilyImage[] {
  return arrayOf(value).flatMap((entry) => {
    if (typeof entry === 'string') {
      const url = entry.trim()
      return isPublicHttpUrl(url) ? [{ url, description: '' }] : []
    }
    const row = recordOf(entry)
    const url = textOf(row.url)
    if (!isPublicHttpUrl(url)) return []
    // 实测（2026-11-11）：开 include_image_descriptions 后对象为 {url,title,description}，
    // description 偶尔为空而 title 有值，此时用 title 兜底。
    return [{ url, description: textOf(row.description) || textOf(row.title) }]
  })
}

/** 纯解析：把一次 Tavily 响应转成调研候选。网页结果在前，图片结果在后。 */
export function tavilyItemsOf(
  payload: unknown,
  queryIndex = 0,
): DesignResearchItem[] {
  const body = recordOf(payload)
  const items: DesignResearchItem[] = []
  const seenImages = new Set<string>()
  for (const [index, entry] of arrayOf(body.results).entries()) {
    const row = recordOf(entry)
    const url = textOf(row.url)
    if (!isPublicHttpUrl(url)) continue
    const title = textOf(row.title) || hostOf(url) || url
    const pageImage = imagesOf(row.images)[0]
    if (pageImage) seenImages.add(pageImage.url)
    items.push({
      id: `tavily:${queryIndex}:web:${index}`,
      source: 'tavily',
      title,
      url,
      imageUrl: pageImage?.url ?? '',
      description: cleanText(textOf(row.content) || title),
      credit: hostOf(url),
    })
  }
  for (const [index, image] of imagesOf(body.images).entries()) {
    if (seenImages.has(image.url)) continue
    seenImages.add(image.url)
    const host = hostOf(image.url)
    items.push({
      id: `tavily:${queryIndex}:image:${index}`,
      source: 'tavily',
      title: cleanText(image.description, 80) || `图片 · ${host}`,
      // 顶层图片没有落地页；来源链接就是图片本身，保存时仍走统一校验与许可说明。
      url: image.url,
      imageUrl: image.url,
      description: cleanText(image.description || `来自 ${host} 的搜索图片`),
      credit: host,
    })
  }
  return items
}

/** 失败原因只取状态码与服务端 `detail.error`，绝不回显请求头。 */
export function tavilyErrorText(error: unknown): { text: string; needsKey: boolean } {
  const app = asAppError(error)
  if (app?.kind === 'http') {
    if (app.status === 401 || app.status === 403) {
      return {
        text: 'Tavily 拒绝了 API Key（401/403）：请到 设置 → Agent → 工具 → 联网调研 检查 Key 是否填对。',
        needsKey: true,
      }
    }
    if (app.status === 432 || app.status === 433) {
      return {
        text: 'Tavily 本月额度已用完或超出套餐上限，请到 Tavily 后台查看用量。',
        needsKey: true,
      }
    }
    if (app.status === 429) {
      return { text: 'Tavily 请求过于频繁（429），请稍后再试。', needsKey: false }
    }
    return { text: `Tavily 搜索失败：HTTP ${app.status}`, needsKey: false }
  }
  if (app?.kind === 'network') {
    return { text: `Tavily 搜索失败：网络错误（${app.detail}）`, needsKey: false }
  }
  return { text: 'Tavily 搜索失败：响应无法解析', needsKey: false }
}

export interface TavilySearchInput {
  apiKey: string | null | undefined
  queries: readonly string[]
  maxResults: number
}

/**
 * 每个检索角度各发一次 Tavily（1 credit / 次，basic 深度）。
 * 多个角度并发；单个失败只记 warning，其余照常返回。
 */
export async function searchTavily(
  network: NetworkPort,
  input: TavilySearchInput,
  signal: AbortSignal,
): Promise<TavilySearchResult> {
  const apiKey = (input.apiKey ?? '').trim()
  const queries = input.queries.map((query) => query.trim()).filter(Boolean).slice(0, 4)
  if (queries.length === 0) return { items: [], warnings: [] }
  if (!apiKey) {
    return { items: [], warnings: [TAVILY_KEY_MISSING_MESSAGE], needsKey: true }
  }
  const perQuery = Math.max(
    1,
    Math.min(TAVILY_MAX_RESULTS, Math.ceil(input.maxResults / queries.length)),
  )
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const response = await network.request(
        {
          url: TAVILY_SEARCH_ENDPOINT,
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: {
            query,
            max_results: perQuery,
            search_depth: 'basic',
            include_images: true,
            include_image_descriptions: true,
            include_answer: false,
          },
          timeoutMs: 30_000,
          maxResponseBytes: 4 * 1024 * 1024,
        },
        signal,
      )
      if (response.status < 200 || response.status >= 300) {
        throw { kind: 'http', status: response.status }
      }
      return response.json<unknown>()
    }),
  )
  const items: DesignResearchItem[] = []
  const warnings: string[] = []
  let needsKey = false
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      items.push(...tavilyItemsOf(result.value, index))
      continue
    }
    const described = tavilyErrorText(result.reason)
    needsKey ||= described.needsKey
    const label = queries.length > 1 ? `（角度「${queries[index]}」）` : ''
    warnings.push(`${described.text}${label}`)
  }
  return { items, warnings: [...new Set(warnings)], ...(needsKey ? { needsKey } : {}) }
}
