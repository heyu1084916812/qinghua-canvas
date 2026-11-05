import { describe, expect, it, vi } from 'vitest'
import { workbenchActionOf, type EcommerceActionPorts } from './pageActionCoordinator'

function ports(overrides: Partial<EcommerceActionPorts> = {}): EcommerceActionPorts {
  return {
    projectId: 'p',
    workbenchResults: [],
    resultRows: [],
    activeTask: null,
    platform: {
      assets: { read: vi.fn(async () => ({ mime: 'image/webp', bytes: { length: 12 } })) },
      files: {},
    },
    assetLibraryRepo: { save: vi.fn(async () => undefined) },
    retryWorkbenchResult: vi.fn(),
    downloadAsset: vi.fn(async () => ({ ok: true })) as unknown as EcommerceActionPorts['downloadAsset'],
    setGenerationStage: vi.fn(),
    ...overrides,
  }
}

describe('ecommerce page action coordinator', () => {
  it('uses the freshest result for retry and routes download by asset hash', async () => {
    const stale = { id: 'r1', taskId: 't', updatedAt: 1, assetHash: 'old' } as never
    const fresh = { id: 'r1', taskId: 't', updatedAt: 2, assetHash: 'new' } as never
    const retryWorkbenchResult = vi.fn()
    const downloadAsset = vi.fn(async () => undefined) as unknown as EcommerceActionPorts['downloadAsset']
    const p = ports({
      workbenchResults: [stale],
      resultRows: [fresh],
      retryWorkbenchResult,
      downloadAsset,
    })
    const action = workbenchActionOf(p)
    action({ id: 'i1', resultId: 'r1', kind: 'image' } as never, 'retry')
    expect(retryWorkbenchResult).toHaveBeenCalledWith('r1')
    action({ id: 'i1', resultId: 'r1', kind: 'image' } as never, 'download')
    expect(downloadAsset).toHaveBeenCalledWith(expect.anything(), 'new')
  })

  it('keeps save success/failure stage paths and payload fallbacks', async () => {
    const save = vi.fn(async () => undefined)
    const setGenerationStage = vi.fn()
    const p = ports({ assetLibraryRepo: { save }, setGenerationStage })
    const action = workbenchActionOf(p)
    action({ id: 'i1', assetHash: 'h', width: 640, height: 480, kind: 'image' } as never, 'save')
    await vi.waitFor(() => expect(save).toHaveBeenCalled())
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      hash: 'h', mime: 'image/webp', bytes: 12, width: 640, height: 480,
    }))
    await vi.waitFor(() => expect(setGenerationStage).toHaveBeenCalledWith({
      phase: 'done', label: '已收藏到素材库',
    }))

    const failStage = vi.fn()
    const failing = ports({
      assetLibraryRepo: { save: vi.fn(async () => { throw new Error('保存失败') }) },
      setGenerationStage: failStage,
    })
    workbenchActionOf(failing)({ id: 'i', assetHash: 'h', kind: 'video' } as never, 'save')
    await vi.waitFor(() => expect(failStage).toHaveBeenCalledWith({
      phase: 'failed', label: '收藏失败', detail: '保存失败',
    }))
  })
})
