import type { DesignResearchItem } from '../../../domain/inspiration/designResearch'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import type { NetworkPort } from '../../../platform/ports'
import { errorTextOf } from '../../../shared/result'

const INTERNET_ARCHIVE_ENDPOINT =
  'https://archive.org/advancedsearch.php'
const ART_INSTITUTE_ENDPOINT =
  'https://api.artic.edu/api/v1/artworks/search'

export async function searchOpenCulture(
  network: NetworkPort,
  query: string,
  limit: number,
  signal: AbortSignal,
): Promise<{ items: DesignResearchItem[]; warnings: string[] }> {
  const archiveLimit = Math.max(1, Math.min(6, Math.ceil(limit / 2)))
  const artLimit = Math.max(1, Math.min(4, Math.floor(limit / 2)))
  const archiveUrl = new URL(INTERNET_ARCHIVE_ENDPOINT)
  archiveUrl.searchParams.set('q', `mediatype:image AND (${query})`)
  for (const field of ['identifier', 'title', 'description']) {
    archiveUrl.searchParams.append('fl[]', field)
  }
  archiveUrl.searchParams.set('rows', String(archiveLimit))
  archiveUrl.searchParams.set('page', '1')
  archiveUrl.searchParams.set('output', 'json')
  const artUrl = new URL(ART_INSTITUTE_ENDPOINT)
  artUrl.searchParams.set('q', query)
  artUrl.searchParams.set(
    'fields',
    'id,title,image_id,artist_display,date_display',
  )
  artUrl.searchParams.set('limit', String(artLimit))

  const [archive, art] = await Promise.allSettled([
    requestJson(network, archiveUrl.toString(), signal, 'Qinghua open archive'),
    requestJson(network, artUrl.toString(), signal, 'Qinghua open culture'),
  ])
  const warnings: string[] = []
  const items: DesignResearchItem[] = []
  if (archive.status === 'fulfilled') {
    items.push(...archiveItems(archive.value, archiveLimit))
  } else {
    warnings.push(`Internet Archive 搜索失败：${errorTextOf(archive.reason)}`)
  }
  if (art.status === 'fulfilled') {
    items.push(...artItems(art.value, artLimit))
  } else {
    warnings.push(`Art Institute 搜索失败：${errorTextOf(art.reason)}`)
  }
  return { items, warnings }
}

function archiveItems(payload: unknown, limit: number): DesignResearchItem[] {
  const response = recordOf(recordOf(payload).response)
  return arrayOf(response.docs)
    .map(recordOf)
    .flatMap((row) => {
      const identifier = textOf(row.identifier)
      if (!identifier) return []
      const title = textOf(row.title) || identifier
      return [{
        id: `internetArchive:${identifier}`,
        source: 'internetArchive' as const,
        title,
        url: `https://archive.org/details/${encodeURIComponent(identifier)}`,
        imageUrl: `https://archive.org/services/img/${encodeURIComponent(identifier)}`,
        description: cleanText(textOf(row.description) || title),
        credit: 'Internet Archive',
      }]
    })
    .filter((item) =>
      isPublicHttpUrl(item.url) && isPublicHttpUrl(item.imageUrl),
    )
    .slice(0, limit)
}

function artItems(payload: unknown, limit: number): DesignResearchItem[] {
  return arrayOf(recordOf(payload).data)
    .map(recordOf)
    .flatMap((row) => {
      const id = Number(row.id)
      const imageId = textOf(row.image_id)
      const title = textOf(row.title)
      if (!Number.isSafeInteger(id) || !imageId || !title) return []
      return [{
        id: `artic:${id}`,
        source: 'artic' as const,
        title,
        url: `https://www.artic.edu/artworks/${id}`,
        imageUrl: `https://www.artic.edu/iiif/2/${encodeURIComponent(imageId)}/full/843,/0/default.jpg`,
        description: cleanText([
          textOf(row.date_display),
          textOf(row.artist_display),
        ].filter(Boolean).join(' · ') || title),
        credit: textOf(row.artist_display) || 'Art Institute of Chicago',
      }]
    })
    .slice(0, limit)
}

async function requestJson(
  network: NetworkPort,
  url: string,
  signal: AbortSignal,
  userAgent: string,
): Promise<unknown> {
  const response = await network.request(
    {
      url,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
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
