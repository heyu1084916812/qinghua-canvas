import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import type { NetworkPort } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'

export interface OpenResearchSearchResult {
  items: DesignResearchItem[]
  warnings: string[]
}

const OPENVERSE_ENDPOINT = 'https://api.openverse.org/v1/images/'
const WIKIPEDIA_ENDPOINT = 'https://zh.wikipedia.org/w/api.php'

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

function cleanText(value: string, limit = 360): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`
}

function openverseItems(payload: unknown, limit: number): DesignResearchItem[] {
  return arrayOf(recordOf(payload).results)
    .map(recordOf)
    .flatMap((row) => {
      const id = textOf(row.id)
      const imageUrl = textOf(row.thumbnail) || textOf(row.url)
      const url = textOf(row.foreign_landing_url) || textOf(row.detail_url)
      const title = textOf(row.title) || 'Openverse image'
      if (!id || !imageUrl || !url) return []
      return [{
        id: `openverse:${id}`,
        source: 'openverse' as const,
        title,
        url,
        imageUrl,
        description: cleanText(textOf(row.attribution) || title),
        credit: textOf(row.creator),
        license: textOf(row.license),
        licenseUrl: textOf(row.license_url),
      }]
    })
    .slice(0, limit)
}

function wikipediaItems(payload: unknown, limit: number): DesignResearchItem[] {
  const query = recordOf(recordOf(payload).query)
  return Object.values(recordOf(query.pages))
    .map(recordOf)
    .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))
    .flatMap((row) => {
      const pageId = Number(row.pageid)
      const url = textOf(row.fullurl) || textOf(row.canonicalurl)
      const title = textOf(row.title)
      if (!Number.isFinite(pageId) || !url || !title) return []
      return [{
        id: `wikipedia:${pageId}`,
        source: 'wikipedia' as const,
        title,
        url,
        imageUrl: textOf(recordOf(row.thumbnail).source),
        description: cleanText(textOf(row.extract) || title),
        credit: 'Wikipedia',
        license: 'CC BY-SA',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      }]
    })
    .slice(0, limit)
}

async function requestJson(
  network: NetworkPort,
  url: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await network.request(
    {
      url,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Qinghua/0.1.17 open-research',
      },
      publicOnly: true,
      maxResponseBytes: 4 * 1024 * 1024,
      timeoutMs: 20_000,
    },
    signal,
  )
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json<unknown>()
}

export async function searchOpenResearch(
  network: NetworkPort,
  topic: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<OpenResearchSearchResult> {
  const query = topic.trim()
  if (!query) return { items: [], warnings: ['调研主题为空，未执行联网搜索'] }
  const imageLimit = Math.max(2, Math.min(12, Math.ceil(maxResults * 0.6)))
  const contentLimit = Math.max(1, Math.min(6, maxResults - imageLimit))
  const openverseUrl = new URL(OPENVERSE_ENDPOINT)
  openverseUrl.searchParams.set('q', query)
  openverseUrl.searchParams.set('page_size', String(imageLimit))
  openverseUrl.searchParams.set('mature', 'false')
  const wikipediaUrl = new URL(WIKIPEDIA_ENDPOINT)
  wikipediaUrl.searchParams.set('action', 'query')
  wikipediaUrl.searchParams.set('generator', 'search')
  wikipediaUrl.searchParams.set('gsrsearch', query)
  wikipediaUrl.searchParams.set('gsrlimit', String(contentLimit))
  wikipediaUrl.searchParams.set('prop', 'extracts|pageimages|info')
  wikipediaUrl.searchParams.set('exintro', '1')
  wikipediaUrl.searchParams.set('explaintext', '1')
  wikipediaUrl.searchParams.set('piprop', 'thumbnail')
  wikipediaUrl.searchParams.set('pithumbsize', '600')
  wikipediaUrl.searchParams.set('inprop', 'url')
  wikipediaUrl.searchParams.set('format', 'json')
  wikipediaUrl.searchParams.set('origin', '*')

  const warnings: string[] = []
  const [images, content] = await Promise.allSettled([
    requestJson(network, openverseUrl.toString(), signal),
    requestJson(network, wikipediaUrl.toString(), signal),
  ])
  const items: DesignResearchItem[] = []
  if (images.status === 'fulfilled') {
    items.push(...openverseItems(images.value, imageLimit))
  } else {
    warnings.push(`Openverse 搜索失败：${errorTextOf(images.reason)}`)
  }
  if (content.status === 'fulfilled') {
    items.push(...wikipediaItems(content.value, contentLimit))
  } else {
    warnings.push(`Wikipedia 搜索失败：${errorTextOf(content.reason)}`)
  }
  return { items, warnings }
}
