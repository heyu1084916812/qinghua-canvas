import { describe, expect, it } from 'vitest'
import {
  availableEditorModes,
  compareHashOf,
  galleryViewOf,
  initialEditorModeOf,
  ownerNodeOf,
} from './lightboxGallery'

describe('Lightbox 画廊与详情派生', () => {
  it('画廊导航只在多于一张时出现，并指向当前素材', () => {
    const items = [
      { assetHash: 'a', nodeId: 'n1', title: 'A' },
      { assetHash: 'b', nodeId: 'n2', title: 'B' },
    ]
    const view = galleryViewOf({ gallery: items, galleryIndex: 1 })
    expect(view.hasGalleryNavigation).toBe(true)
    expect(view.galleryItem.title).toBe('B')
    expect(galleryViewOf({ gallery: [items[0]], galleryIndex: 0 }).hasGalleryNavigation).toBe(false)
  })

  it('归属节点与对比配对只认素材 hash 和节点已落库字段', () => {
    const nodes = [
      { id: 'n1', title: '结果', data: { assetHash: 'a', compareWith: 'source' } },
      { id: 'n2', title: '别的图', data: { assetHash: 'b' } },
    ]
    expect(ownerNodeOf(nodes, 'a')?.id).toBe('n1')
    expect(ownerNodeOf(nodes, 'missing')).toBeUndefined()
    expect(compareHashOf(nodes, 'a')).toBe('source')
    expect(compareHashOf(nodes, 'a', 'explicit')).toBe('explicit')
    expect(compareHashOf(nodes, 'b')).toBeNull()
  })

  it('打开灯箱先尊重显式编辑意图，再回落到对比 / 查看', () => {
    const base = { assetHash: 'a', nodeHasComparePair: false }
    expect(initialEditorModeOf({ ...base, faceFor: 'n1' })).toBe('face')
    expect(initialEditorModeOf({ ...base, cropFor: 'n1', cropPlain: true })).toBe('crop')
    expect(initialEditorModeOf({ ...base, cropFor: 'n1' })).toBe('extract')
    expect(initialEditorModeOf({ ...base, rotateFor: 'n1' })).toBe('rotate')
    expect(initialEditorModeOf({ ...base, annotateFor: 'n1' })).toBe('annotate')
    expect(initialEditorModeOf({ ...base, nodeHasComparePair: true })).toBe('compare')
    expect(initialEditorModeOf({ ...base, assetHash: undefined })).toBe('view')
  })

  it('模式条按能力过滤，不摆点了没反应的入口', () => {
    expect(
      availableEditorModes({
        canCrop: true,
        canAnnotate: false,
        canRotate: true,
        compareAvailable: false,
      }),
    ).toEqual(['view', 'extract', 'crop', 'rotate'])
    expect(
      availableEditorModes({
        canCrop: true,
        canAnnotate: true,
        canRotate: false,
        compareAvailable: true,
        faceFor: 'n1',
      }),
    ).toEqual(['view', 'face', 'annotate', 'compare'])
  })
})
