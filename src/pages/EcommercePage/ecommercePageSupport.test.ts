import { describe, expect, it } from 'vitest'
import {
  ecommerceBatchId,
  ecommerceImageParamOptionsByModel,
  ecommerceSubjectId,
  ecommerceVisualInputsOf,
  freshestWorkbenchResults,
  legacyAssetHashesOfNode,
} from './ecommercePageSupport'

describe('ecommerce page support', () => {
  it('keeps legacy asset hashes unique and skips disabled nodes', () => {
    expect(legacyAssetHashesOfNode({
      id: 'n1',
      data: { assetHash: 'a', compareWith: 'a', leftAssetHash: 'b', cropContext: { source: { assetHash: 'c' } } },
    })).toEqual(['a', 'b', 'c'])
    expect(legacyAssetHashesOfNode({ id: 'n2', disabled: true, data: { assetHash: 'a' } })).toEqual([])
  })

  it('collects product and reference asset inputs without duplicating node ids', () => {
    const inputs = ecommerceVisualInputsOf({
      mediaKind: 'image',
      usage: 'set',
      language: 'zh-CN',
      platformId: 'amazon',
      count: 1,
      ratio: '1:1',
      note: '',
      productNodeId: 'p1',
      productNodeIds: ['p1', 'p2'],
      referenceNodeIds: ['r1'],
    }, [{ id: 'p1', data: { assetHash: 'hash-a', assetMime: 'image/webp' } }], {
      p2: { mime: 'image/png' },
      r1: { mime: 'image/jpeg' },
    })
    expect(inputs.map((input) => input.assetHash)).toEqual(['hash-a', 'p2', 'r1'])
    expect(inputs[0]?.mime).toBe('image/webp')
  })

  it('keeps the newest result and stable id prefixes', () => {
    const stale = { id: 'r', updatedAt: 1, status: 'running' } as never
    const fresh = { id: 'r', updatedAt: 2, status: 'done' } as never
    expect(freshestWorkbenchResults([stale], [fresh]).get('r')).toBe(fresh)
    expect(ecommerceBatchId()).toMatch(/^ecb_/)
    expect(ecommerceSubjectId()).toMatch(/^ecsubject_/)
    expect(ecommerceImageParamOptionsByModel(['GPT Image 2'])).toHaveProperty('GPT Image 2')
  })
})
