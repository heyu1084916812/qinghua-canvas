export type ResearchProvider =
  | 'google'
  | 'pinterest'
  | 'behance'
  | 'openverse'
  | 'wikipedia'
  | 'internetArchive'
  | 'artic'
  | 'cleveland'
  | 'met'
  | 'searxng'
  | 'tavily'
  | 'bing'
  /** 花瓣直连适配器（#1076 方案 D）。 */
  | 'huaban'
  /** 站酷直连适配器（#1076 方案 D）。 */
  | 'zcool'
  /** Agent 后台浏览器适配器（#1087）：Dribbble / The Dieline / Packaging of the World（Pinterest 沿用 `pinterest`）。 */
  | 'dribbble'
  | 'thedieline'
  | 'packagingoftheworld'
  | 'web'

export type ResearchMode = 'image' | 'web' | 'mixed'

export const DEFAULT_RESEARCH_MODE: ResearchMode = 'image'
export const DEFAULT_RESEARCH_MAX_RESULTS = 12
export const DEFAULT_RESEARCH_IMAGE_RESULTS = 40
export const MIN_RESEARCH_IMAGE_RESULTS = 30
export const MAX_RESEARCH_IMAGE_RESULTS = 50
export const MIN_RESEARCH_MAX_RESULTS = 1
export const MAX_RESEARCH_MAX_RESULTS = 100
export const MAX_RESEARCH_URLS = 8
export const DESIGN_RESEARCH_MAX_IMAGE_PIXELS = 20_000_000

export const DESIGN_RESEARCH_RIGHTS_NOTE =
  '仅收集公开页面元数据与来源链接。图片权利归原作者所有，保存或商用前请核对来源许可。'

/**
 * SearXNG 不再有内置公共实例（2026-11-11）：唯一的默认实例 `www.isci.si` 对 JSON API 长期 429，
 * 等于每轮都白发两次请求、刷一条警告。现在留空 = 跳过；用户自建实例时再填。
 */
export const DEFAULT_SEARXNG_ENDPOINT = ''
/** 旧版本写进设置里的公共默认实例；读到它按“未配置”处理。 */
export const LEGACY_PUBLIC_SEARXNG_ENDPOINT = 'https://www.isci.si/search'

export interface WebSearchSettings {
  endpoint: string
}

export function normalizeSearxngEndpoint(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''
    if (!url.pathname.endsWith('/search')) url.pathname = '/search'
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

export interface DesignResearchRequest {
  topic: string
  urls: string[]
  maxResults: number
  mode: ResearchMode
  imageMaxResults: number
}

export interface PlannedResearchQuery {
  source: Exclude<ResearchProvider, 'web'>
  query: string
  url: string
}

export interface DesignResearchItem {
  id: string
  source: ResearchProvider
  title: string
  url: string
  imageUrl: string
  /** 同一张图的备用原图地址；主地址失效时按顺序尝试。 */
  imageUrls?: string[]
  description?: string
  credit?: string
  license?: string
  licenseUrl?: string
}

export interface ResearchSourceSummary {
  source: ResearchProvider
  name: string
  url: string
  itemCount: number
}

export interface MoodboardGroup {
  id: ResearchProvider
  title: string
  itemIds: string[]
}

export interface DesignResearchReport {
  request: DesignResearchRequest
  queries: PlannedResearchQuery[]
  items: DesignResearchItem[]
  sources: ResearchSourceSummary[]
  moodboard: MoodboardGroup[]
  rightsNote: string
  totalItems: number
}

export interface BuildDesignResearchReportInput {
  request: DesignResearchRequest
  items: readonly DesignResearchItem[]
  queries?: readonly PlannedResearchQuery[]
}

const TRACKING_QUERY_PARAMS = new Set([
  'epik',
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'ref',
  'referrer',
  'source',
])

const IMAGE_RESEARCH_INTENT =
  /(图片|图像|照片|海报|封面|视觉|风格|参考|灵感|moodboard|配色|颜色|字体|logo|包装|插画|摄影|构图|排版|\bui\b|网页设计|品牌视觉)/i
const WEB_RESEARCH_INTENT =
  /(网页|网站|文章|新闻|报道|行业|市场|深度报告|数据分析|竞品分析|价格|评测|百科|文献|教程|研究方法|事实|资料查询|report|article|news|research)/i
const MIXED_RESEARCH_INTENT =
  /(图文|既要.{0,8}图片.{0,8}也要|图片.{0,8}(?:和|与|及|加).{0,8}(?:网页|文章|报道|资料)|(?:网页|文章|报道|资料).{0,8}(?:和|与|及|加).{0,8}图片)/i

const PROVIDER_TITLES: Record<ResearchProvider, string> = {
  google: 'Web references',
  pinterest: 'Pinterest',
  behance: 'Behance',
  openverse: 'Openverse',
  wikipedia: 'Wikipedia',
  internetArchive: 'Internet Archive',
  artic: 'Art Institute',
  cleveland: 'Cleveland Museum',
  met: 'Met Museum',
  searxng: 'SearXNG',
  tavily: 'Tavily 网页搜索',
  bing: 'Bing 免 Key 搜索',
  huaban: '花瓣',
  zcool: '站酷',
  dribbble: 'Dribbble',
  thedieline: 'The Dieline',
  packagingoftheworld: 'Packaging of the World',
  web: 'Other references',
}

const PROVIDER_ORDER: readonly ResearchProvider[] = [
  'huaban',
  'zcool',
  'dribbble',
  'thedieline',
  'packagingoftheworld',
  'pinterest',
  'bing',
  'tavily',
  'behance',
  'openverse',
  'wikipedia',
  'internetArchive',
  'artic',
  'cleveland',
  'met',
  'searxng',
  'google',
  'web',
]

interface HtmlTag {
  name: string
  attrs: Record<string, string>
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);?/gi, (match, token: string) => {
    const normalized = token.toLowerCase()
    if (normalized === 'amp') return '&'
    if (normalized === 'quot') return '"'
    if (normalized === 'apos') return "'"
    if (normalized === 'lt') return '<'
    if (normalized === 'gt') return '>'
    if (normalized === 'nbsp') return ' '
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16)
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10)
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match
    }
    return match
  })
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1]?.toLowerCase()
    if (!name) continue
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[name] = decodeHtmlEntities(value)
  }
  return attrs
}

function parseOpeningTags(html: string): HtmlTag[] {
  const tags: HtmlTag[] = []
  let cursor = 0

  while (cursor < html.length) {
    const start = html.indexOf('<', cursor)
    if (start < 0) break

    if (html.startsWith('<!--', start)) {
      const commentEnd = html.indexOf('-->', start + 4)
      if (commentEnd < 0) break
      cursor = commentEnd + 3
      continue
    }

    let quote = ''
    let end = start + 1
    for (; end < html.length; end += 1) {
      const char = html[end]
      if (quote) {
        if (char === quote) quote = ''
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (char === '>') break
    }

    if (end >= html.length) break
    const raw = html.slice(start + 1, end).trim()
    cursor = end + 1
    if (!raw || raw.startsWith('/') || raw.startsWith('!') || raw.startsWith('?')) continue

    const nameMatch = /^([a-z][\w:-]*)/i.exec(raw)
    if (!nameMatch) continue
    const name = nameMatch[1]!.toLowerCase()
    tags.push({
      name,
      attrs: parseAttributes(raw.slice(nameMatch[0].length)),
    })
  }

  return tags
}

function isStrippedQueryParam(name: string): boolean {
  return /^utm_/i.test(name) || TRACKING_QUERY_PARAMS.has(name.toLowerCase())
}

function normalizeHttpUrl(raw: string, base?: string): string {
  const value = decodeHtmlEntities(raw).trim()
  if (!value || /^(?:data|blob|javascript|mailto|tel):/i.test(value)) return ''

  try {
    const url = new URL(value, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.hash = ''
    url.username = ''
    url.password = ''
    for (const key of Array.from(url.searchParams.keys())) {
      if (isStrippedQueryParam(key)) url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return ''
  }
}

function canonicalUrlKey(raw: string): string {
  const normalized = normalizeHttpUrl(raw)
  if (!normalized) return ''

  try {
    const url = new URL(normalized)
    url.hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
    url.searchParams.sort()

    const pinId = /^\/pin\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1]
    if (pinId) {
      url.pathname = `/pin/${pinId}/`
    } else {
      url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    }

    const search = url.searchParams.toString()
    return `${url.protocol}//${url.host}${url.pathname}${search ? `?${search}` : ''}`
  } catch {
    return ''
  }
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function metaValues(html: string, names: ReadonlySet<string>): string[] {
  const values: string[] = []
  for (const tag of parseOpeningTags(html)) {
    if (tag.name !== 'meta') continue
    const key = (tag.attrs.property || tag.attrs.name || '').toLowerCase()
    if (!names.has(key)) continue
    const content = tag.attrs.content ?? ''
    if (content) values.push(content)
  }
  return values
}

function srcsetUrl(value: string): string {
  const candidates = value
    .split(',')
    .map((entry) => entry.trim().split(/\s+/)[0] ?? '')
    .filter(Boolean)
  return candidates.length > 0 ? candidates[candidates.length - 1]! : ''
}

function imageUrlFromAttrs(attrs: Record<string, string>): string {
  return (
    attrs['data-src'] ||
    attrs['data-original'] ||
    attrs['data-lazy-src'] ||
    attrs['data-pin-media'] ||
    attrs.src ||
    srcsetUrl(attrs.srcset || '')
  )
}

function cleanHtmlText(value: string): string {
  return normalizeWhitespace(decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')))
}

function isUiOnlyPinterestText(value: string): boolean {
  return /^(?:pin|save|save pin|more like this)$/i.test(value)
}

function pinIdFromUrl(raw: string): string {
  const normalized = normalizeHttpUrl(raw)
  if (!normalized) return ''
  try {
    const url = new URL(normalized)
    if (url.hostname !== 'pinterest.com' && !url.hostname.endsWith('.pinterest.com')) {
      return ''
    }
    return /^\/pin\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] ?? ''
  } catch {
    return ''
  }
}

function imageTagValues(html: string): string[] {
  const values: string[] = []
  for (const tag of parseOpeningTags(html)) {
    if (tag.name !== 'img') continue
    const raw = imageUrlFromAttrs(tag.attrs)
    if (raw) values.push(raw)
  }
  return values
}

function sourceOrigin(rawUrl: string): { name: string; url: string } {
  const normalized = normalizeHttpUrl(rawUrl)
  if (!normalized) return { name: 'Unknown source', url: '' }

  try {
    const url = new URL(normalized)
    const hostname = url.hostname.replace(/^www\./i, '').toLowerCase()
    const port = url.port ? `:${url.port}` : ''
    return {
      name: hostname,
      url: `${url.protocol}//${hostname}${port}`,
    }
  } catch {
    return { name: 'Unknown source', url: '' }
  }
}

function clampMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RESEARCH_MAX_RESULTS
  }
  const normalized = Math.trunc(value)
  return Math.min(
    MAX_RESEARCH_MAX_RESULTS,
    Math.max(MIN_RESEARCH_MAX_RESULTS, normalized),
  )
}

export function isResearchMode(value: unknown): value is ResearchMode {
  return value === 'image' || value === 'web' || value === 'mixed'
}

export function researchModeOf(value: unknown): ResearchMode | undefined {
  return isResearchMode(value) ? value : undefined
}

/**
 * 模式推断只用于模型漏传 mode 的情况。图片/风格/参考类请求是 researchDesign
 * 的主路径，所以无法判定时回退 image；显式网页或图文混合意图才切到 web / mixed。
 */
export function inferResearchMode(input: {
  mode?: unknown
  topic?: string
  queries?: readonly string[]
}): ResearchMode {
  const explicit = researchModeOf(input.mode)
  if (explicit) return explicit
  const text = [input.topic ?? '', ...(input.queries ?? [])].join(' ')
  if (MIXED_RESEARCH_INTENT.test(text)) return 'mixed'
  if (IMAGE_RESEARCH_INTENT.test(text)) return 'image'
  if (WEB_RESEARCH_INTENT.test(text)) return 'web'
  return DEFAULT_RESEARCH_MODE
}

export function normalizeResearchImageResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RESEARCH_IMAGE_RESULTS
  }
  return Math.min(
    MAX_RESEARCH_IMAGE_RESULTS,
    Math.max(MIN_RESEARCH_IMAGE_RESULTS, Math.trunc(value)),
  )
}

export function normalizeResearchRequest(
  topic: string,
  urls: string | readonly string[] | null | undefined = [],
  maxResults?: number,
  options: { mode?: unknown; imageMaxResults?: number } = {},
): DesignResearchRequest {
  const candidates = typeof urls === 'string' ? [urls] : urls ?? []
  const normalizedUrls: string[] = []
  const seen = new Set<string>()

  for (const candidate of candidates) {
    const normalized = normalizeHttpUrl(candidate)
    const key = canonicalUrlKey(normalized)
    if (!normalized || !key || seen.has(key)) continue
    seen.add(key)
    normalizedUrls.push(normalized)
    if (normalizedUrls.length >= MAX_RESEARCH_URLS) break
  }

  return {
    topic: normalizeWhitespace(topic),
    urls: normalizedUrls,
    maxResults: clampMaxResults(maxResults),
    mode: inferResearchMode({
      mode: options.mode,
      topic,
    }),
    imageMaxResults: normalizeResearchImageResults(options.imageMaxResults),
  }
}

function searchUrl(source: PlannedResearchQuery['source'], query: string): string {
  const encoded = encodeURIComponent(query)
  if (source === 'pinterest') {
    return `https://www.pinterest.com/search/pins/?q=${encoded}`
  }
  if (source === 'behance') {
    return `https://www.behance.net/search/projects?search=${encoded}`
  }
  return `https://www.google.com/search?q=${encoded}`
}

export function planResearchQueries(topic: string): PlannedResearchQuery[] {
  const normalizedTopic = normalizeWhitespace(topic)
  if (!normalizedTopic) return []

  const templates: ReadonlyArray<{
    source: PlannedResearchQuery['source']
    query: string
  }> = [
    { source: 'google', query: `${normalizedTopic} visual design inspiration` },
    { source: 'google', query: `${normalizedTopic} brand moodboard references` },
    { source: 'pinterest', query: `${normalizedTopic} design ideas` },
    { source: 'pinterest', query: `${normalizedTopic} moodboard` },
    { source: 'behance', query: `${normalizedTopic} branding` },
    { source: 'behance', query: `${normalizedTopic} visual identity` },
  ]

  return templates.map(({ source, query }) => ({
    source,
    query,
    url: searchUrl(source, query),
  }))
}

export function extractOpenGraphImages(html: string, pageUrl: string): string[] {
  const resolveAll = (values: readonly string[]): string[] =>
    uniqueStrings(values.map((value) => normalizeHttpUrl(value, pageUrl)).filter(Boolean))

  const openGraph = resolveAll(
    metaValues(html, new Set(['og:image', 'og:image:url', 'og:image:secure_url'])),
  )
  if (openGraph.length > 0) return openGraph

  const social = resolveAll(metaValues(html, new Set(['twitter:image', 'twitter:image:src'])))
  if (social.length > 0) return social

  const linked = uniqueStrings(
    parseOpeningTags(html)
      .filter((tag) => tag.name === 'link')
      .filter((tag) => /(?:^|\s)image_src(?:\s|$)/i.test(tag.attrs.rel ?? ''))
      .map((tag) => normalizeHttpUrl(tag.attrs.href ?? '', pageUrl))
      .filter(Boolean),
  )
  if (linked.length > 0) return linked

  return uniqueStrings(
    imageTagValues(html)
      .map((value) => normalizeHttpUrl(value, pageUrl))
      .filter(Boolean),
  )
}

export function parsePinterestHtml(html: string, pageUrl: string): DesignResearchItem[] {
  if (typeof html !== 'string' || !html.trim()) return []

  const byPinId = new Map<string, DesignResearchItem>()
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorPattern.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] ?? '')
    const href = attrs.href ?? ''
    const url = normalizeHttpUrl(href, pageUrl)
    const pinId = pinIdFromUrl(url)
    if (!pinId) continue

    const content = match[2] ?? ''
    const images = parseOpeningTags(content).filter((tag) => tag.name === 'img')
    const imageTag = images[0]
    const imageUrl = imageTag
      ? normalizeHttpUrl(imageUrlFromAttrs(imageTag.attrs), pageUrl)
      : ''
    const anchorText = cleanHtmlText(content)
    const title = normalizeWhitespace(
      attrs.title ||
        attrs['aria-label'] ||
        imageTag?.attrs.alt ||
        (isUiOnlyPinterestText(anchorText) ? '' : anchorText),
    )

    const existing = byPinId.get(pinId)
    if (existing) {
      if (!existing.title && title) existing.title = title
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl
      continue
    }

    byPinId.set(pinId, {
      id: `pinterest:${pinId}`,
      source: 'pinterest',
      title,
      url,
      imageUrl,
    })
  }

  const pagePinId = pinIdFromUrl(pageUrl)
  if (pagePinId) {
    const title = normalizeWhitespace(
      metaValues(html, new Set(['og:title', 'twitter:title']))[0] ?? '',
    ).replace(/\s*\|\s*Pinterest\s*$/i, '')
    const imageValues = metaValues(
      html,
      new Set(['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']),
    )
    const imageUrl = normalizeHttpUrl(imageValues[0] ?? '', pageUrl)
    const existing = byPinId.get(pagePinId)

    if (existing) {
      if (!existing.title && title) existing.title = title
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl
    } else if (title || imageUrl) {
      byPinId.set(pagePinId, {
        id: `pinterest:${pagePinId}`,
        source: 'pinterest',
        title,
        url: normalizeHttpUrl(pageUrl),
        imageUrl,
      })
    }
  }

  return Array.from(byPinId.values())
}

export function dedupeResearchItems(
  items: readonly DesignResearchItem[],
): DesignResearchItem[] {
  const seenUrls = new Set<string>()
  const seenImages = new Set<string>()
  const seenFallbacks = new Set<string>()
  const out: DesignResearchItem[] = []

  for (const item of items) {
    const urlKey = canonicalUrlKey(item.url)
    const imageKey = canonicalUrlKey(item.imageUrl)

    if (urlKey && seenUrls.has(urlKey)) continue
    if (imageKey && seenImages.has(imageKey)) continue

    const fallbackKey = !urlKey && !imageKey
      ? `${item.source}|${item.id}|${normalizeWhitespace(item.title)}`
      : ''
    if (fallbackKey && seenFallbacks.has(fallbackKey)) continue

    if (urlKey) seenUrls.add(urlKey)
    if (imageKey) seenImages.add(imageKey)
    if (fallbackKey) seenFallbacks.add(fallbackKey)
    out.push(item)
  }

  return out
}

function selectedItemsForMode(
  request: DesignResearchRequest,
  items: readonly DesignResearchItem[],
): DesignResearchItem[] {
  const deduped = dedupeResearchItems(items)
  if (request.mode === 'image') {
    return deduped
      .filter((item) => item.imageUrl.length > 0)
      .slice(0, request.imageMaxResults)
  }
  if (request.mode === 'web') {
    return deduped.slice(0, request.maxResults)
  }

  const seenIds = new Set<string>()
  const selected: DesignResearchItem[] = []
  const push = (item: DesignResearchItem) => {
    if (seenIds.has(item.id)) return false
    seenIds.add(item.id)
    selected.push(item)
    return true
  }
  for (const item of deduped.filter((candidate) => candidate.imageUrl.length > 0)) {
    if (selected.length >= request.imageMaxResults) break
    push(item)
  }
  let textOnlyCount = 0
  for (const item of deduped) {
    if (item.imageUrl.length > 0) continue
    if (textOnlyCount >= request.maxResults) break
    if (push(item)) textOnlyCount += 1
  }
  return selected
}

export function buildDesignResearchReport(
  input: BuildDesignResearchReportInput,
): DesignResearchReport {
  const limit = clampMaxResults(input.request.maxResults)
  const imageLimit = normalizeResearchImageResults(input.request.imageMaxResults)
  const normalizedRequest: DesignResearchRequest = {
    ...input.request,
    maxResults: limit,
    mode: researchModeOf(input.request.mode) ?? DEFAULT_RESEARCH_MODE,
    imageMaxResults: imageLimit,
  }
  const items = selectedItemsForMode(normalizedRequest, input.items)
  const queries = input.queries
    ? [...input.queries]
    : planResearchQueries(input.request.topic)

  const sourceMap = new Map<string, ResearchSourceSummary>()
  for (const item of items) {
    const origin = sourceOrigin(item.url)
    const key = `${item.source}|${origin.url}`
    const existing = sourceMap.get(key)
    if (existing) {
      existing.itemCount += 1
    } else {
      sourceMap.set(key, {
        source: item.source,
        name: origin.name,
        url: origin.url,
        itemCount: 1,
      })
    }
  }

  const sources = Array.from(sourceMap.values()).sort((left, right) => {
    if (left.itemCount !== right.itemCount) return right.itemCount - left.itemCount
    if (left.name !== right.name) return left.name.localeCompare(right.name)
    return left.source.localeCompare(right.source)
  })

  const moodboard: MoodboardGroup[] = []
  for (const provider of PROVIDER_ORDER) {
    const itemIds = items.filter((item) => item.source === provider).map((item) => item.id)
    if (itemIds.length === 0) continue
    moodboard.push({
      id: provider,
      title: PROVIDER_TITLES[provider],
      itemIds,
    })
  }

  return {
    request: {
      ...normalizedRequest,
      topic: normalizeWhitespace(normalizedRequest.topic),
      urls: [...normalizedRequest.urls],
    },
    queries,
    items,
    sources,
    moodboard,
    rightsNote: DESIGN_RESEARCH_RIGHTS_NOTE,
    totalItems: items.length,
  }
}
