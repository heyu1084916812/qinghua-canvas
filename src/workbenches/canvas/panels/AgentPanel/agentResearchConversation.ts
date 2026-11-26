import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import type { ResearchMode } from '../../../../domain/inspiration/designResearch'

export interface ConversationResearchItem {
  id: string
  title: string
  url: string
  imageUrl: string
  source: string
  description?: string
  credit?: string
  license?: string
  licenseUrl?: string
}

export interface ConversationResearchSiteStatus {
  site: string
  status: string
  itemCount: number
  note?: string
}

export interface ConversationResearchStatus {
  target: number
  actual: number
  queries: string[]
  siteStatuses: ConversationResearchSiteStatus[]
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function projectResearchConversation(
  record: Record<string, unknown>,
  researchMode: ResearchMode | undefined,
  clean: (value: unknown) => string,
): {
  items: ConversationResearchItem[]
  itemCount: number
  status: ConversationResearchStatus
} {
  const rawItems = arrayOf(record.items).map(recordOf)
  const request = recordOf(record.request)
  const items = rawItems.flatMap((item): ConversationResearchItem[] => {
    const url = String(item.url ?? '')
    if (!isPublicHttpUrl(url)) return []
    const imageUrl = String(item.imageUrl ?? '')
    return [{
      id: String(item.id ?? url),
      title: clean(String(item.title ?? url)),
      url,
      imageUrl: isPublicHttpUrl(imageUrl) ? imageUrl : '',
      source: String(item.source ?? 'web'),
      description: clean(String(item.description ?? '')),
      credit: clean(String(item.credit ?? '')),
      license: clean(String(item.license ?? '')),
      licenseUrl: clean(String(item.licenseUrl ?? '')),
    }]
  }).slice(0, researchMode === 'web' ? 48 : 120)
  const queries = arrayOf(record.searchQueries)
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 6)
  const siteStatuses = arrayOf(record.siteStatuses).flatMap(
    (value): ConversationResearchSiteStatus[] => {
      const row = recordOf(value)
      const site = String(row.site ?? '').trim()
      const status = String(row.status ?? '').trim()
      if (!site || !status) return []
      const note = String(row.note ?? '').trim()
      return [{
        site,
        status,
        itemCount: Number.isFinite(Number(row.itemCount))
          ? Math.max(0, Number(row.itemCount))
          : 0,
        ...(note ? { note } : {}),
      }]
    },
  )
  return {
    items,
    itemCount: rawItems.length,
    status: {
      target: Math.max(
        0,
        Number(researchMode === 'image' ? request.imageMaxResults : request.maxResults) || 0,
      ),
      actual: rawItems.length,
      queries,
      siteStatuses,
    },
  }
}
