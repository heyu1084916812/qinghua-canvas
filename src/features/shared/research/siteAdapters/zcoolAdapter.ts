import type { DesignResearchItem } from '../../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import { fetchSiteText, plainTitle, siteFailureText, siteFetchFailureOf } from './siteFetch'
import type { DirectSiteAdapter, SiteAdapterOutcome } from './types'

/**
 * 站酷：`GET https://www.zcool.com.cn/search/content?word=<词>` 返回服务端渲染的 HTML（免登录）。
 *
 * 解析口径（2026-11-13 实测）：
 * 1. 首选页面里 Next.js RSC 负载（`self.__next_f.push([1,"…"])`）中的 `initialItems` 数组：
 *    每条作品有 `title`（带 `<b class='hightlight'>` 高亮）、`cover*` 封面、`pageUrl` 作品页、
 *    `creatorObj.username`。只取 `objectType === 3`（作品）；文章 / 运营位跳过。
 * 2. RSC 认不出时退回 `normal-card-item` 卡片：`aria-label` 标题 + `img.zcool.cn` 缩略图；
 *    卡片本身没有作品链接（`role="button"`），只能指向搜索页。
 *
 * 图址：`img.zcool.cn/community/…?k=…&t=<十六进制过期时间>` 是签名地址，约一天后失效；
 * 无 Referer 或站酷 Referer 200，外站 Referer 403（画廊 `no-referrer` 满足）。
 */
export const ZCOOL_SEARCH_ENDPOINT = 'https://www.zcool.com.cn/search/content'
const ZCOOL_LABEL = '站酷'
const ZCOOL_WORK_TYPE = 3

export function zcoolSearchUrl(query: string): string {
  const url = new URL(ZCOOL_SEARCH_ENDPOINT)
  url.searchParams.set('word', query)
  return url.toString()
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isZcoolHost(url: string, hosts: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return hosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  } catch {
    return false
  }
}

const isZcoolImage = (url: string) => isPublicHttpUrl(url) && isZcoolHost(url, ['zcool.cn'])
const isZcoolPage = (url: string) => isPublicHttpUrl(url) && isZcoolHost(url, ['zcool.com.cn'])

/** 拼出 RSC 文本：所有 `self.__next_f.push([1,"…"])` 的字符串字面量按顺序解码后相连。 */
export function zcoolRscText(html: string): string {
  const parts: string[] = []
  const pattern = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  for (const match of html.matchAll(pattern)) {
    try {
      const decoded: unknown = JSON.parse(match[1]!)
      if (typeof decoded === 'string') parts.push(decoded)
    } catch {
      /* 单段坏掉不影响其它段 */
    }
  }
  return parts.join('')
}

/** 从 `"initialItems":[` 起按字符串感知的括号配对截出数组并解析。 */
export function zcoolInitialItems(rsc: string): unknown[] | null {
  const marker = rsc.indexOf('"initialItems":[')
  if (marker < 0) return null
  const start = rsc.indexOf('[', marker)
  let depth = 0
  let inString = false
  for (let i = start; i < rsc.length; i += 1) {
    const ch = rsc[i]
    if (inString) {
      if (ch === '\\') i += 1
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth += 1
    else if (ch === ']' || ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(rsc.slice(start, i + 1))
          return Array.isArray(parsed) ? parsed : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function rscItems(rows: readonly unknown[], queryIndex: number): DesignResearchItem[] {
  return rows.flatMap((raw, index): DesignResearchItem[] => {
    const row = recordOf(raw)
    if (row.objectType !== ZCOOL_WORK_TYPE) return []
    const pageUrl = textOf(row.pageUrl)
    const covers = [textOf(row.cover3x), textOf(row.cover), textOf(row.cover2x)].filter(isZcoolImage)
    const imageUrl = covers[0]
    if (!imageUrl || !isZcoolPage(pageUrl)) return []
    const title = plainTitle(textOf(row.title)) || '站酷作品'
    const author = plainTitle(textOf(recordOf(row.creatorObj).username))
    const category = [textOf(row.cateStr), textOf(row.subCateStr)].filter(Boolean).join(' / ')
    const id = textOf(row.idStr) || String(row.id ?? index)
    return [{
      id: `zcool:${queryIndex}:${id}`,
      source: 'zcool',
      title,
      url: pageUrl,
      imageUrl,
      ...(covers.length > 1 ? { imageUrls: [...new Set(covers.slice(1))] } : {}),
      description: `站酷作品${category ? ` · ${category}` : ''}`,
      ...(author ? { credit: author } : {}),
    }]
  })
}

function decodeAttr(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/** RSC 认不出时的退路：解析 `normal-card-item` 卡片。 */
export function zcoolCardItems(html: string, searchUrl: string, queryIndex = 0): DesignResearchItem[] {
  const items: DesignResearchItem[] = []
  const starts = [...html.matchAll(/<div\b[^>]*class="[^"]*\bnormal-card-item\b[^"]*"[^>]*>/g)]
  for (const [index, match] of starts.entries()) {
    const begin = match.index ?? 0
    const end = starts[index + 1]?.index ?? Math.min(html.length, begin + 20_000)
    const card = html.slice(begin, end)
    const label = /aria-label="([^"]*)"/.exec(match[0])?.[1] ?? ''
    const img = /<img\b[^>]*\bsrc="(https:\/\/img\.zcool\.cn\/[^"]+)"/.exec(card)?.[1] ?? ''
    const imageUrl = decodeAttr(img)
    if (!isZcoolImage(imageUrl)) continue
    const work = /href="(https:\/\/www\.zcool\.com\.cn\/work\/[^"]+)"/.exec(card)?.[1] ?? ''
    const url = work && isZcoolPage(decodeAttr(work)) ? decodeAttr(work) : searchUrl
    items.push({
      id: `zcool:${queryIndex}:card:${index}`,
      source: 'zcool',
      title: plainTitle(decodeAttr(label)) || '站酷作品',
      url,
      imageUrl,
      description: '站酷作品',
    })
  }
  return items
}

export interface ZcoolParseResult {
  recognized: boolean
  items: DesignResearchItem[]
}

export function parseZcoolSearch(html: string, searchUrl: string, queryIndex = 0): ZcoolParseResult {
  const rows = zcoolInitialItems(zcoolRscText(html))
  if (rows) {
    const items = rscItems(rows, queryIndex)
    if (items.length > 0) return { recognized: true, items }
  }
  const cards = zcoolCardItems(html, searchUrl, queryIndex)
  if (cards.length > 0) return { recognized: true, items: cards }
  return { recognized: rows !== null || /normal-card-item|zm02cG_grid/.test(html), items: [] }
}

export const zcoolAdapter: DirectSiteAdapter = {
  kind: 'direct',
  id: 'zcool',
  label: ZCOOL_LABEL,
  domain: 'zcool.com.cn',
  async search(network, request, signal): Promise<SiteAdapterOutcome> {
    const base = { id: 'zcool' as const, label: ZCOOL_LABEL }
    const searchUrl = zcoolSearchUrl(request.query)
    let html: string
    try {
      html = await fetchSiteText(network, searchUrl, 'text/html,application/xhtml+xml', signal)
    } catch (error) {
      const status = siteFetchFailureOf(error)
      return { ...base, status, items: [], failureText: siteFailureText(ZCOOL_LABEL, status) }
    }
    const parsed = parseZcoolSearch(html, searchUrl, request.queryIndex)
    const items = parsed.items.slice(0, Math.max(0, request.limit))
    if (items.length > 0) return { ...base, status: 'ok', items }
    const status = parsed.recognized ? 'empty' : 'unrecognized'
    return { ...base, status, items: [], failureText: siteFailureText(ZCOOL_LABEL, status) }
  },
}
