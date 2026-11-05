import { describe, expect, it, vi } from 'vitest'
import type { EcommerceResultItem, EcommerceUpload } from '../studioContracts'
import {
  availableStudioUpscaleOptions,
  runStudioUpscale,
  studioBatchEditFailureMessage,
  studioBatchEditSubmission,
  studioEditableResult,
  studioEditFailureMessage,
  studioEditSubmission,
  studioUploadFailureMessage,
  studioUploadPreviewItems,
  studioUploadPreviewStep,
  studioUpscalableResult,
} from './studioResultActionCoordinator'

const upload = (nodeId: string): EcommerceUpload => ({ nodeId, hash: nodeId, preview: null })
const item = (
  nodeId: string,
  status: EcommerceResultItem['status'],
  mime?: string,
): EcommerceResultItem => ({ nodeId, status, ...(mime ? { mime } : {}) })

describe('studio result action coordinator', () => {
  it('builds single edit options and rejects an empty instruction before any call', () => {
    expect(studioEditSubmission('  ', null, '')).toEqual({
      error: '先写清这一张要改什么，例如：只把背景换成海边日落，产品和文字保持不变',
    })
    expect(studioEditSubmission('  只换背景  ', upload('ref'), 'edit-model')).toEqual({
      instruction: '只换背景',
      options: { referenceNodeId: 'ref', model: 'edit-model' },
    })
    expect(studioEditFailureMessage(new Error('渠道失败'))).toBe('渠道失败')
  })

  it('selects only done image results in result order and preserves batch options', () => {
    const results = [
      item('done-image', 'done', 'image/png'),
      item('running-image', 'running', 'image/png'),
      item('failed-image', 'failed', 'image/png'),
      item('video', 'done', 'video/mp4'),
      item('done-no-mime', 'done'),
    ]
    expect(studioBatchEditSubmission({
      instruction: '  统一换背景  ',
      results,
      selectedNodeIds: new Set(['done-image', 'running-image', 'video', 'done-no-mime']),
      reference: upload('batch-ref'),
      model: 'batch-model',
    })).toEqual({
      imageNodeIds: ['done-image', 'done-no-mime'],
      instruction: '统一换背景',
      options: { referenceNodeId: 'batch-ref', model: 'batch-model' },
    })
    expect(studioBatchEditSubmission({
      instruction: '',
      results,
      selectedNodeIds: new Set(['done-image']),
      reference: null,
      model: '',
    })).toEqual({ error: '先写清这批图要统一改什么' })
    expect(studioBatchEditSubmission({
      instruction: '换背景',
      results,
      selectedNodeIds: new Set(),
      reference: null,
      model: '',
    })).toEqual({ error: '先选择至少一张结果' })
    expect(studioBatchEditFailureMessage(new Error('批量失败'))).toBe('批量失败')
  })

  it('runs upscale sequentially and records partial completion on failure', async () => {
    const onUpscale = vi.fn(async (nodeId: string) => {
      if (nodeId === 'r2') throw new Error('第二张失败')
    })
    const progress = await runStudioUpscale({
      items: [item('r1', 'done'), item('r2', 'done'), item('r3', 'done')],
      profile: 'standard',
      scale: '4x',
      onUpscale,
    })
    expect(onUpscale.mock.calls.map((call) => call[0])).toEqual(['r1', 'r2'])
    expect(progress).toEqual({ completed: 1, error: '已完成 1/3 张；第二张失败' })
  })

  it('reports first-item upscale failure without a fake completed prefix', async () => {
    const progress = await runStudioUpscale({
      items: [item('r1', 'done')],
      profile: 'cgi',
      scale: '2x',
      onUpscale: async () => { throw new Error('渠道不可用') },
    })
    expect(progress).toEqual({ completed: 0, error: '渠道不可用' })
  })

  it('keeps upscale profiles filtered and result actions gated by running/video/options', () => {
    expect(availableStudioUpscaleOptions(['standard', 'cgi']).map((option) => option.id)).toEqual([
      'standard',
      'cgi',
    ])
    expect(availableStudioUpscaleOptions(undefined)).toHaveLength(5)
    expect(studioEditableResult(item('r1', 'done'), false, true)).toBe(true)
    expect(studioEditableResult(item('r1', 'done'), true, true)).toBe(false)
    expect(studioEditableResult(item('video', 'done', 'video/mp4'), false, true)).toBe(false)
    expect(studioUpscalableResult(item('r1', 'done'), false, true, 1)).toBe(true)
    expect(studioUpscalableResult(item('r1', 'done'), false, true, 0)).toBe(false)
  })

  it('keeps upload preview source, bounded keyboard steps and the read failure text', () => {
    const products = [upload('p1'), upload('p2')]
    const references = [upload('r1')]
    expect(studioUploadPreviewItems({ kind: 'product', index: 0 }, products, references)).toBe(products)
    expect(studioUploadPreviewItems({ kind: 'reference', index: 0 }, products, references)).toBe(references)
    expect(studioUploadPreviewItems(null, products, references)).toEqual([])
    const preview = { kind: 'product' as const, index: 1 }
    expect(studioUploadPreviewStep(preview, -1, 2)).toEqual({ kind: 'product', index: 0 })
    expect(studioUploadPreviewStep(preview, 1, 2)).toBe(preview)
    expect(studioUploadPreviewStep({ kind: 'reference', index: 0 }, -1, 1)).toEqual({
      kind: 'reference',
      index: 0,
    })
    expect(studioUploadFailureMessage()).toBe('参考图没能读进来（格式不支持或读取失败）')
  })
})
