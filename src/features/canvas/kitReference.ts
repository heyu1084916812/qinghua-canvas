import type {
  ContextKit,
  ContextKitAsset,
  ContextKitVersion,
} from '../../domain/shared/context'
import type { ReferenceItem } from '../../domain/project/referenceLedger'
import type { PlatformKit } from '../../platform/ports'
import { createReferenceLedgerRepository } from '../../state/project/referenceLedgerRepository'

/** 把套件或套件图片投影成一条稳定的项目参考，用于生成可解析的 Agent chip。 */
export async function ensureKitCardReference(
  platform: PlatformKit,
  projectId: string,
  kit: ContextKit,
  version: ContextKitVersion,
): Promise<ReferenceItem> {
  const primary = version.resources.find((item) => item.role === 'logo') ?? version.resources[0]
  return ensureReference(platform, projectId, {
    id: `ref_kit_${kit.id}`,
    title: kit.name,
    asset: primary,
    what: [
      `${kitKindLabel(kit.kind)}「${kit.name}」当前 v${version.version}。`,
      kit.description.trim(),
      version.guide.trim(),
      `包含 ${version.resources.length} 张图片、${version.colors.length} 个颜色、${version.fonts.length} 个字体。`,
    ].filter(Boolean).join(' '),
    kit,
    version,
  })
}

export async function ensureKitAssetReference(
  platform: PlatformKit,
  projectId: string,
  kit: ContextKit,
  version: ContextKitVersion,
  resource: ContextKitAsset,
): Promise<ReferenceItem> {
  return ensureReference(platform, projectId, {
    id: `ref_kit_asset_${kit.id}_${resource.hash.slice(0, 12)}`,
    title: resource.name.trim() || kit.name,
    asset: resource,
    what: `来自${kitKindLabel(kit.kind)}「${kit.name}」v${version.version} 的图片素材${resource.name.trim() ? `「${resource.name.trim()}」` : ''}。`,
    kit,
    version,
  })
}

async function ensureReference(
  platform: PlatformKit,
  projectId: string,
  input: {
    id: string
    title: string
    asset?: ContextKitAsset
    what: string
    kit: ContextKit
    version: ContextKitVersion
  },
): Promise<ReferenceItem> {
  const repository = createReferenceLedgerRepository(platform.storage)
  const existing = (await repository.listItems(projectId)).find((item) => item.id === input.id)
  const [assetRow] = input.asset
    ? await platform.storage.query('assets', { id: input.asset.hash }, {
        includePayload: false,
        fields: ['id', 'mime'],
      })
    : []
  const mime = typeof assetRow?.mime === 'string' ? assetRow.mime : ''
  const kind: ReferenceItem['kind'] = mime.startsWith('video/')
    ? 'video'
    : mime.startsWith('image/')
      ? 'image'
      : 'document'
  const now = Date.now()
  const item: ReferenceItem = {
    id: input.id,
    projectId,
    title: input.title.trim() || input.kit.name,
    source: 'kit',
    kind,
    ...(input.asset ? { assetHash: input.asset.hash } : {}),
    kitId: input.kit.id,
    kitVersion: input.version.version,
    what: input.what,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await repository.putItem(item)
  return item
}

function kitKindLabel(kind: ContextKit['kind']): string {
  if (kind === 'brand') return '品牌套件'
  if (kind === 'product') return '产品套件'
  if (kind === 'role') return '角色套件'
  return '自定义套件'
}
