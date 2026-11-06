import { describe, expect, it } from 'vitest'
import { lightboxEditorProjectionOf } from './lightboxEditorProjection'

const nodes = [
  { id: 'owner', title: '结果图', data: { assetHash: 'asset-a' } },
  { id: 'other', title: '其它', data: { assetHash: 'asset-b' } },
]

describe('lightboxEditorProjectionOf', () => {
  it('resolves the owner and explicit editor targets with capability flags', () => {
    const result = lightboxEditorProjectionOf({
      nodes,
      assetHash: 'asset-a',
      isVideo: false,
      mode: 'face',
      lightbox: {
        assetHash: 'asset-a',
        faceFor: 'face-node',
        cropPlain: true,
        rotateFor: 'rotate-node',
        annotateFor: 'annotate-node',
      },
      compareAvailable: true,
    })

    expect(result.ownerNode).toMatchObject({ id: 'owner', title: '结果图' })
    expect(result.ownerNodeId).toBe('owner')
    expect(result.cropNodeId).toBe('face-node')
    expect(result.rotateNodeId).toBe('rotate-node')
    expect(result.annotateNodeId).toBe('annotate-node')
    expect(result.canCrop).toBe(true)
    expect(result.canRotate).toBe(true)
    expect(result.canAnnotate).toBe(true)
    expect(result.cropping).toBe(true)
    expect(result.plainCrop).toBe(false)
    expect(result.availableModes.map((mode) => mode.id)).toContain('face')
    expect(result.availableModes.map((mode) => mode.id)).not.toContain('extract')
    expect(result.availableModes.map((mode) => mode.id)).toContain('compare')
  })

  it('keeps target ids but disables image editing for video media', () => {
    const result = lightboxEditorProjectionOf({
      nodes,
      assetHash: 'asset-a',
      isVideo: true,
      mode: 'rotate',
      lightbox: { assetHash: 'asset-a' },
      compareAvailable: false,
    })

    expect(result.ownerNodeId).toBe('owner')
    expect(result.canCrop).toBe(false)
    expect(result.canRotate).toBe(false)
    expect(result.canAnnotate).toBe(false)
    expect(result.rotating).toBe(false)
    expect(result.availableModes.map((mode) => mode.id)).toEqual(['view'])
  })

  it('prefers crop over face and preserves requested plain-crop mode', () => {
    const result = lightboxEditorProjectionOf({
      nodes,
      assetHash: 'asset-a',
      isVideo: false,
      mode: 'crop',
      lightbox: {
        assetHash: 'asset-a',
        cropFor: 'crop-node',
        faceFor: 'face-node',
        cropPlain: true,
      },
      compareAvailable: false,
    })

    expect(result.cropNodeId).toBe('crop-node')
    expect(result.cropPlainRequested).toBe(true)
    expect(result.plainCrop).toBe(true)
    expect(result.cropping).toBe(true)
    expect(result.availableModes.map((mode) => mode.id)).toContain('face')
  })
})
