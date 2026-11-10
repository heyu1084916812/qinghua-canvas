import { describe, expect, it, vi } from 'vitest'
import type { ReferenceItem } from '../../domain/project/referenceLedger'
import { addReferenceAsset, addReferenceLink } from './referenceSourceAdd'

describe('reference source add', () => {
  it('adds an image link as a link reference', async () => {
    const put = vi.fn(async (_item: ReferenceItem) => undefined)
    await addReferenceLink(put, 'project-1', 'https://example.com/reference.png')
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        source: 'link',
        kind: 'image',
        url: 'https://example.com/reference.png',
      }),
    )
  })

  it('rejects unsafe links and maps video assets', async () => {
    const put = vi.fn(async (_item: ReferenceItem) => undefined)
    await expect(
      addReferenceLink(put, 'project-1', 'javascript:alert(1)'),
    ).rejects.toThrow('只支持 http 或 https 链接')
    await addReferenceAsset(put, 'project-1', {
      hash: 'video-hash',
      mime: 'video/mp4',
      bytes: 1,
      savedAt: 1,
    })
    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'asset',
        kind: 'video',
        assetHash: 'video-hash',
      }),
    )
  })
})
