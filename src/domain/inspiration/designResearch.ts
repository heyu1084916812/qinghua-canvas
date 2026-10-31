export type ResearchProvider = 'google' | 'pinterest' | 'behance' | 'web'

export const DEFAULT_RESEARCH_MAX_RESULTS = 24
export const MIN_RESEARCH_MAX_RESULTS = 1
export const MAX_RESEARCH_MAX_RESULTS = 100
export const MAX_RESEARCH_URLS = 8
export const DESIGN_RESEARCH_MAX_IMAGE_PIXELS = 20_000_000

export const DESIGN_RESEARCH_RIGHTS_NOTE =
  '仅收集公开页面元数据与来源链接。图片权利归原作者所有，保存或商用前请核对来源许可。'

export interface DesignResearchRequest {
  topic: string
  urls: string[]
  maxResults: number
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

const PROVIDER_TITLES: Record<ResearchProvider, string> = {
  google: 'Web references',
  pinterest: 'Pinterest',
  behance: 'Behance',
  web: 'Other references',
}

const PROVIDER_ORDER: readonly ResearchProvider[] = [
  'pinterest',
  'behance',
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

export function normalizeResearchRequest(
  topic: string,
  urls: string | readonly string[] | null | undefined = [],
  maxResults?: number,
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

export function buildDesignResearchReport(
  input: BuildDesignResearchReportInput,
): DesignResearchReport {
  const limit = clampMaxResults(input.request.maxResults)
  const items = dedupeResearchItems(input.items).slice(0, limit)
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
      ...input.request,
      topic: normalizeWhitespace(input.request.topic),
      urls: [...input.request.urls],
      maxResults: limit,
    },
    queries,
    items,
    sources,
    moodboard,
    rightsNote: DESIGN_RESEARCH_RIGHTS_NOTE,
    totalItems: items.length,
  }
}
