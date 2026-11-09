import type { ClipperItem } from '../../../domain/inspiration/clipper'
import type { LibraryAsset } from '../../../domain/shared/assetLibrary'
import type { PlatformKit } from '../../../platform/ports'
import { sendAssetToActiveCanvas } from '../../../features/assets/sendToActiveCanvas'
import { saveDesignResearchItem } from '../../../features/shared/research/saveResearchItem'
import type { ReferenceLedgerRepository } from '../../../state/project/referenceLedgerRepository'

export async function saveClipperAsset(
  platform: PlatformKit,
  item: ClipperItem,
  signal: AbortSignal,
): Promise<LibraryAsset> {
  const saved = await saveDesignResearchItem(
    item,
    { network: platform.network, storage: platform.storage },
    signal,
  )
  if (!saved.ok || !saved.asset) throw new Error(saved.message)
  return saved.asset
}

export async function addClipperReference(input: {
  platform: PlatformKit
  ledger: ReferenceLedgerRepository
  projectId: string
  item: ClipperItem
  signal: AbortSignal
}): Promise<string> {
  const asset = await saveClipperAsset(input.platform, input.item, input.signal)
  const now = Date.now()
  const id = `ref_clipper_${asset.hash.slice(0, 12)}`
  await input.ledger.putItem({
    id,
    projectId: input.projectId,
    title: input.item.title,
    source: 'clipper',
    kind: 'image',
    assetHash: asset.hash,
    url: input.item.url,
    what: input.item.description?.trim()
      || `网页收藏「${input.item.title}」，来源 ${input.item.url}。`,
    createdAt: now,
    updatedAt: now,
  })
  return id
}

export async function sendClipperToCanvas(
  platform: PlatformKit,
  item: ClipperItem,
  signal: AbortSignal,
): Promise<void> {
  const asset = await saveClipperAsset(platform, item, signal)
  await sendAssetToActiveCanvas(platform, asset)
}
