import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import { ensureFreshDisplayThumb, rememberFreshAsset } from '../../platform/freshAssets'
import { activeCanvasId } from '../../state/project/activeCanvas'
import type { ContextKitAsset, ContextKitAssetRole } from '../../domain/shared/context'
import type { PlatformKit } from '../../platform/ports'
import { MAX_ASSET_BYTES } from './contextKitDraft'

export interface ContextKitStoragePort {
  put: PlatformKit['storage']['put']
}

export async function persistContextKitImage(
  blob: Blob,
  name: string,
  role: ContextKitAssetRole,
  projectId: string,
  storage: ContextKitStoragePort,
): Promise<ContextKitAsset> {
  if (!blob.type.startsWith('image/')) {
    throw new Error('这里只支持图片文件')
  }
  if (blob.size > MAX_ASSET_BYTES) {
    throw new Error(`${name || '图片'}超过 20MB`)
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length === 0) throw new Error(`${name || '图片'}没有内容`)
  const hash = await fingerprintBytes(bytes)
  const mime = blob.type || 'image/png'
  const size = imageSizeFromHeader(bytes)
  const fresh = new Blob([bytes as unknown as BlobPart], { type: mime })
  rememberFreshAsset(hash, fresh)
  void ensureFreshDisplayThumb(hash, size)
  await storage.put(
    'assets',
    {
      id: hash,
      hash,
      mime,
      bytes,
      ...(size ?? {}),
      createdAt: Date.now(),
      projectId: projectId || activeCanvasId() || 'context-kits',
    } as never,
  )
  return {
    hash,
    role,
    name: name.trim() || `素材 ${hash.slice(0, 6)}`,
  }
}