import type { HistoryOutput } from '../../domain/shared/assetHistory'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'

/** Project a history output into the shared gallery card shape. */
export function cardAssetOf(item: HistoryOutput): LibraryAsset {
  return {
    hash: item.hash,
    mime: item.mime,
    bytes: item.bytes,
    width: item.width,
    height: item.height,
    savedAt: item.createdAt,
    projectId: item.projectId,
    prompt: item.prompt,
    model: item.model,
    quality: item.quality,
    ratio: item.ratio,
    channelId: item.channelId,
    ...(item.tags && item.tags.length > 0 ? { tags: item.tags } : {}),
  }
}

export function timeLabelOf(at: number): string {
  if (!at) return ''
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hours}:${minutes}`
}
