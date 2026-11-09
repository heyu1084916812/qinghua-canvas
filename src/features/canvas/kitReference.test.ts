import { describe, expect, it } from 'vitest'
import type { ContextKit, ContextKitVersion } from '../../domain/shared/context'
import { createMemoryPlatform } from '../../platform/memory'
import { createReferenceLedgerRepository } from '../../state/project/referenceLedgerRepository'
import {
  ensureKitAssetReference,
  ensureKitCardReference,
} from './kitReference'

const kit: ContextKit = {
  id: 'brand-anbel',
  kind: 'brand',
  name: 'Anbel',
  description: '自然有机品牌',
  currentVersion: 3,
  createdAt: 1,
  updatedAt: 3,
}

const version: ContextKitVersion = {
  id: 'brand-anbel:v3',
  kitId: kit.id,
  version: 3,
  guide: '保留绿色识别和留白',
  facts: [],
  assetHashes: ['logo-hash', 'photo-hash'],
  resources: [
    { hash: 'logo-hash', role: 'logo', name: 'Anbel 标志' },
    { hash: 'photo-hash', role: 'reference', name: '空间照片' },
  ],
  colors: [{ id: 'green', name: '主色', value: '#8fc466' }],
  fonts: [{ id: 'abeezee', name: 'ABeeZee', detail: 'Regular' }],
  checksum: 'checksum',
  createdAt: 3,
}

describe('kit reference projection', () => {
  it('projects a kit card with stable identity and version evidence', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('assets', { id: 'logo-hash', mime: 'image/png' })

    const item = await ensureKitCardReference(platform, 'project-1', kit, version)
    const rows = await createReferenceLedgerRepository(platform.storage).listItems('project-1')

    expect(item.id).toBe('ref_kit_brand-anbel')
    expect(item.assetHash).toBe('logo-hash')
    expect(item.assets).toEqual([
      { hash: 'logo-hash', role: 'logo', name: 'Anbel 标志' },
      { hash: 'photo-hash', role: 'reference', name: '空间照片' },
    ])
    expect(item.kitVersion).toBe(3)
    expect(item.what).toContain('2 张图片')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: item.id,
      projectId: 'project-1',
      source: 'kit',
      kind: 'image',
    })
  })

  it('keeps individual kit image references distinct from the kit card', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('assets', { id: 'photo-hash', mime: 'image/webp' })

    const item = await ensureKitAssetReference(
      platform,
      'project-1',
      kit,
      version,
      version.resources[1]!,
    )
    const rows = await createReferenceLedgerRepository(platform.storage).listItems('project-1')

    expect(item.id).toBe('ref_kit_asset_brand-anbel_photo-hash')
    expect(item.title).toBe('空间照片')
    expect(item.assets).toEqual([
      { hash: 'photo-hash', role: 'reference', name: '空间照片' },
    ])
    expect(item.what).toContain('品牌套件「Anbel」v3')
    expect(item.kind).toBe('image')
    expect(rows).toHaveLength(1)
  })
})
