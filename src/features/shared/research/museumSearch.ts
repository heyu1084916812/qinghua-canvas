import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import type { NetworkPort } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'

const CLEVELAND_ENDPOINT =
  'https://openaccess-api.clevelandart.org/api/artworks/'
const MET_SEARCH_ENDPOINT =
  'https://collectionapi.metmuseum.org/public/collection/v1.1/search'
const MET_OBJECT_ENDPOINT =
  'https://collectionapi.metmuseum.org/public/collection/v1/objects'
const USER_AGENT = 'Qinghua museum research'

export async function searchMuseumCollections(
  network: NetworkPort,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<{ items: DesignResearchItem[]; warnings: string[] }> {
  const sourceLimit = Math.max(1, Math.min(3, Math.ceil(limit / 2)))
  const clevelandUrl = new URL(CLEVELAND_ENDPOINT)
  clevelandUrl.searchParams.set('q', query)
  clevelandUrl.searchParams.set('cc0', '1')
  clevelandUrl.searchParams.set('has_image', '1')
  clevelandUrl.searchParams.set('limit', String(sourceLimit))
  clevelandUrl.searchParams.set(
    'fields',
    'id,title,creation_date,creators,images,url,share_license_status,description',
  )
  const metUrl = new URL(MET_SEARCH_ENDPOINT)
  metUrl.searchParams.set('q', query)
  metUrl.searchParams.set('hasImages', 'true')
  metUrl.searchParams.set('offset', '0')
  metUrl.searchParams.set('limit', String(Math.max(2, sourceLimit * 2)))

  const [cleveland, met] = await Promise.allSettled([
    requestJson(network, clevelandUrl.toString(), signal),
    requestJson(network, metUrl.toString(), signal),
  ])
  const warnings: string[] = []
  const items: DesignResearchItem[] = []
  if (cleveland.status === 'fulfilled') {
    items.push(...clevelandItems(cleveland.value, sourceLimit))
  } else {
    warnings.push(`Cleveland Museum 搜索失败：${errorTextOf(cleveland.reason)}`)
  }
  if (met.status === 'fulfilled') {
    const result = await metItems(network, met.value, sourceLimit, signal)
    items.push(...result.items)
    warnings.push(...result.warnings)
  } else {
    warnings.push(`Met Museum 搜索失败：${errorTextOf(met.reason)}`)
  }
  return { items, warnings }
}

function clevelandItems(payload: unknown, limit: number): DesignResearchItem[] {
  return arrayOf(recordOf(payload).data)
    .map(recordOf)
    .flatMap((row) => {
      const id = Number(row.id)
      const images = recordOf(row.images)
      const imageUrl = textOf(recordOf(images.print).url)
        || textOf(recordOf(images.web).url)
      const url = textOf(row.url)
      const title = textOf(row.title)
      if (
        !Number.isSafeInteger(id)
        || !imageUrl
        || !url
        || !title
        || textOf(row.share_license_status) !== 'CC0'
      ) return []
      const creator = textOf(recordOf(arrayOf(row.creators)[0]).description)
      return [{
        id: `cleveland:${id}`,
        source: 'cleveland' as const,
        title,
        url,
        imageUrl,
        description: cleanText([
          textOf(row.creation_date),
          textOf(row.description),
        ].filter(Boolean).join(' · ') || title),
        credit: creator || 'Cleveland Museum of Art',
        license: 'CC0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      }]
    })
    .filter((item) =>
      isPublicHttpUrl(item.url) && isPublicHttpUrl(item.imageUrl),
    )
    .slice(0, limit)
}

async function metItems(
  network: NetworkPort,
  payload: unknown,
  limit: number,
  signal: AbortSignal,
): Promise<{ items: DesignResearchItem[]; warnings: string[] }> {
  const objectIds = arrayOf(recordOf(payload).objectIDs)
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, Math.max(2, limit * 2))
  const results = await Promise.allSettled(objectIds.map((id) =>
    requestJson(network, `${MET_OBJECT_ENDPOINT}/${id}`, signal),
  ))
  const warnings: string[] = []
  if (results.some((result) => result.status === 'rejected')) {
    warnings.push('Met Museum 部分馆藏读取失败，已跳过不可用条目')
  }
  const items = results
    .flatMap((result) => result.status === 'fulfilled'
      ? metItem(result.value)
      : [])
    .slice(0, limit)
  return { items, warnings }
}

function metItem(payload: unknown): DesignResearchItem[] {
  const row = recordOf(payload)
  const id = Number(row.objectID)
  const imageUrl = textOf(row.primaryImageSmall) || textOf(row.primaryImage)
  const url = textOf(row.objectURL)
  const title = textOf(row.title)
  if (
    !Number.isSafeInteger(id)
    || row.isPublicDomain !== true
    || !imageUrl
    || !url
    || !title
  ) return []
  return [{
    id: `met:${id}`,
    source: 'met' as const,
    title,
    url,
    imageUrl,
    description: cleanText([
      textOf(row.objectDate),
      textOf(row.medium),
      textOf(row.artistDisplayName),
    ].filter(Boolean).join(' · ') || title),
    credit: textOf(row.artistDisplayName) || 'The Metropolitan Museum of Art',
    license: 'Public Domain',
    licenseUrl: 'https://www.metmuseum.org/about-the-met/policies-and-documents/open-access',
  }]
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
        'User-Agent': USER_AGENT,
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

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ')
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function cleanText(value: string): string {
  return value.length <= 360 ? value : `${value.slice(0, 359)}…`
}
