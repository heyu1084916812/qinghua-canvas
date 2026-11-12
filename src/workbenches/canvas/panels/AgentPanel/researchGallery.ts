import { isPublicHttpUrl } from '../../../../domain/shared/publicUrl'
import type { ConversationResearchItem } from './conversation'

export function researchHostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function researchImageItems(
  items: readonly ConversationResearchItem[],
): ConversationResearchItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!isPublicHttpUrl(item.imageUrl) || seen.has(item.imageUrl)) return false
    seen.add(item.imageUrl)
    return true
  })
}

export function researchWebItems(
  items: readonly ConversationResearchItem[],
): ConversationResearchItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!isPublicHttpUrl(item.url) || item.url === item.imageUrl || seen.has(item.url)) {
      return false
    }
    seen.add(item.url)
    return true
  })
}

export function researchPreviewItems(
  items: readonly ConversationResearchItem[],
  limit = 3,
): ConversationResearchItem[] {
  return researchImageItems(items).slice(0, Math.max(1, limit))
}
