import type { ReferenceItem } from '../../domain/project/referenceLedger'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { createId } from '../../shared/id'

type PutReference = (item: ReferenceItem) => Promise<void>

function referenceKindOfUrl(url: URL): ReferenceItem['kind'] {
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) return 'image'
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return 'video'
  return 'document'
}

export async function addReferenceLink(
  putReference: PutReference,
  projectId: string,
  raw: string,
) {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('请输入完整链接')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http 或 https 链接')
  }
  const now = Date.now()
  await putReference({
    id: createId('ref'),
    projectId,
    title: url.hostname || '链接参考',
    source: 'link',
    kind: referenceKindOfUrl(url),
    url: url.toString(),
    what: `链接参考：${url.toString()}`,
    createdAt: now,
    updatedAt: now,
  })
}

export async function addReferenceAsset(
  putReference: PutReference,
  projectId: string,
  asset: LibraryAsset,
) {
  const now = Date.now()
  await putReference({
    id: createId('ref'),
    projectId,
    title: asset.prompt?.trim().slice(0, 32) || `素材 ${asset.hash.slice(0, 6)}`,
    source: 'asset',
    kind: asset.mime.startsWith('video/') ? 'video' : 'image',
    assetHash: asset.hash,
    what: '来自已收藏素材的参考。',
    createdAt: now,
    updatedAt: now,
  })
}
