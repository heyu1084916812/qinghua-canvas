import type { ClipperItem } from '../../../domain/inspiration/clipper'
import { isPublicHttpUrl } from '../../../domain/shared/publicUrl'
import type { NetworkPort } from '../../../platform/ports'
import type { ClipperCollectionRepository } from '../../../state/shared/clipperCollectionRepository'
import {
  ClipperCaptureError,
} from './clipperImageValidation'
import {
  capturePendingClipperClip,
} from './clipperCapture'

export async function capturePendingClipperQueue(input: {
  clips: readonly {
    id: string
    url: string
    title?: string
    imageUrl?: string
    imageUrls?: string[]
  }[]
  network: NetworkPort
  collection: ClipperCollectionRepository
  signal: AbortSignal
}): Promise<{
  collection: ClipperItem[]
  imported: number
  importedIds: string[]
  discardedIds: string[]
  failed: { id: string; message: string; retryable: boolean }[]
}> {
  let collection = await input.collection.load()
  let imported = 0
  const importedIds: string[] = []
  const discardedIds: string[] = []
  const failed: { id: string; message: string; retryable: boolean }[] = []
  for (const clip of input.clips) {
    if (!isPublicHttpUrl(clip.url)) {
      discardedIds.push(clip.id)
      failed.push({
        id: clip.id,
        message: '网页地址不是公开 HTTP / HTTPS 地址',
        retryable: false,
      })
      continue
    }
    try {
      const result = await capturePendingClipperClip({
        pageUrl: clip.url,
        imageUrl: clip.imageUrl,
        imageUrls: clip.imageUrls,
        title: clip.title,
        network: input.network,
        collection: input.collection,
        signal: input.signal,
      })
      if (result.items.length === 0) {
        discardedIds.push(clip.id)
        failed.push({
          id: clip.id,
          message: '没有识别到可导入的图片',
          retryable: false,
        })
        continue
      }
      collection = result.collection
      imported += result.items.length
      importedIds.push(clip.id)
    } catch (error) {
      const retryable = !(error instanceof ClipperCaptureError) || error.retryable
      if (!retryable) discardedIds.push(clip.id)
      failed.push({
        id: clip.id,
        message: error instanceof Error ? error.message : String(error),
        retryable,
      })
    }
  }
  return { collection, imported, importedIds, discardedIds, failed }
}
