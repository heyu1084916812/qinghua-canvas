import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ECOMMERCE_FORM_DRAFT,
  type EcommerceFormDraft,
} from '../../../domain/ecommerce/draft'
import type { AssetPayload } from '../../../platform/ports'
import type { LegacyGenerationNode } from '../ecommercePageSupport'
import {
  createEcommerceDraftAutoSaveController,
  ECOMMERCE_DRAFT_AUTOSAVE_MS,
  restoreEcommercePageDraft,
  type EcommerceDraftAutoSaveScheduler,
} from './pageDraftActionCoordinator'

const draftOf = (overrides: Partial<EcommerceFormDraft> = {}): EcommerceFormDraft => ({
  ...DEFAULT_ECOMMERCE_FORM_DRAFT,
  ...overrides,
})

const node = (id: string, data: Record<string, unknown> = { assetHash: `hash-${id}` }): LegacyGenerationNode => ({
  id,
  type: 'generation',
  data,
})

const asset = (id: string): AssetPayload => ({
  bytes: new Uint8Array([1]),
  mime: `image/${id}`,
})

function schedulerFixture(): {
  scheduler: EcommerceDraftAutoSaveScheduler
  run(id: number): void
  ids(): number[]
} {
  let nextId = 0
  const callbacks = new Map<number, () => void>()
  return {
    scheduler: {
      setTimeout: vi.fn((callback: () => void, milliseconds: number) => {
        expect(milliseconds).toBe(ECOMMERCE_DRAFT_AUTOSAVE_MS)
        const id = ++nextId
        callbacks.set(id, callback)
        return id
      }),
      clearTimeout: vi.fn((id: number) => {
        callbacks.delete(id)
      }),
    },
    run(id: number) {
      const callback = callbacks.get(id)
      if (!callback) throw new Error(`missing timer ${id}`)
      callbacks.delete(id)
      callback()
    },
    ids: () => [...callbacks.keys()],
  }
}

describe('ecommerce page draft action coordinator', () => {
  it('reads draft and nodes in parallel, dedupes ids, and prefers node assets', async () => {
    const calls: string[] = []
    const loadedDraft = draftOf({
      productNodeId: 'node-a',
      productNodeIds: ['node-a', 'asset-a', 'asset-a'],
      referenceNodeIds: ['shared'],
    })
    const result = await restoreEcommercePageDraft({
      projectId: 'p1',
      repository: {
        load: vi.fn(async () => {
          calls.push('draft')
          return loadedDraft
        }),
        nodes: vi.fn(async () => {
          calls.push('nodes')
          return [node('node-a'), node('shared', { assetHash: 'shared-node-hash' })]
        }),
        save: vi.fn(),
      },
      assets: {
        read: vi.fn(async (id: string) => {
          calls.push(`asset:${id}`)
          return id === 'asset-a' || id === 'shared' ? asset(id) : null
        }),
      },
    })

    expect(calls.slice(0, 2).sort()).toEqual(['draft', 'nodes'])
    expect(calls).not.toContain('asset:node-a')
    expect(calls).not.toContain('asset:shared')
    expect(result).toMatchObject({
      products: [
        { nodeId: 'node-a', hash: 'hash-node-a', kind: 'node' },
        { nodeId: 'asset-a', hash: 'asset-a', kind: 'asset' },
      ],
      references: [
        { nodeId: 'shared', hash: 'shared-node-hash', kind: 'node' },
      ],
    })
  })

  it('cleans missing refs and writes back only when cleanup changes identities', async () => {
    const save = vi.fn(async () => true)
    const dirty = draftOf({
      productNodeId: 'gone-product',
      productNodeIds: ['gone-product', 'node-a'],
      referenceNodeIds: ['gone-reference', 'asset-a-1', 'asset-a-1'],
    })
    const result = await restoreEcommercePageDraft({
      projectId: 'p1',
      repository: {
        load: vi.fn(async () => dirty),
        nodes: vi.fn(async () => [node('node-a')]),
        save,
      },
      assets: {
        read: vi.fn(async (id: string) => id === 'asset-a-1' ? asset(id) : null),
      },
    })

    expect(result?.draft).toMatchObject({
      productNodeId: 'node-a',
      productNodeIds: ['node-a'],
      referenceNodeIds: ['asset-a-1'],
    })
    expect(result?.references).toEqual([
      { nodeId: 'asset-a-1', hash: 'asset-a-1', kind: 'asset' },
    ])
    expect(save).toHaveBeenCalledWith('p1', expect.objectContaining({
      productNodeIds: ['node-a'],
      referenceNodeIds: ['asset-a-1'],
    }))
  })

  it('does not write back when every restored reference is still valid', async () => {
    const save = vi.fn(async () => true)
    const result = await restoreEcommercePageDraft({
      projectId: 'p1',
      repository: {
        load: vi.fn(async () => draftOf({
          productNodeId: 'node-a',
          productNodeIds: ['node-a'],
          referenceNodeIds: ['asset-a'],
        })),
        nodes: vi.fn(async () => [node('node-a')]),
        save,
      },
      assets: {
        read: vi.fn(async () => asset('asset-a')),
      },
    })

    expect(result?.draft?.productNodeIds).toEqual(['node-a'])
    expect(save).not.toHaveBeenCalled()
  })

  it('returns null when the host cancels after the parallel reads', async () => {
    let cancelled = false
    const result = await restoreEcommercePageDraft({
      projectId: 'p1',
      repository: {
        load: vi.fn(async () => {
          cancelled = true
          return draftOf()
        }),
        nodes: vi.fn(async () => []),
        save: vi.fn(),
      },
      assets: { read: vi.fn(async () => null) },
      isCancelled: () => cancelled,
    })
    expect(result).toBeNull()
  })

  it('debounces changes with a single latest timer', () => {
    const timers = schedulerFixture()
    let latest: EcommerceFormDraft | null = null
    const save = vi.fn()
    const controller = createEcommerceDraftAutoSaveController({
      save,
      scheduler: timers.scheduler,
      state: {
        getLatest: () => latest,
        setLatest: (draft) => {
          latest = draft
        },
      },
    })
    const first = draftOf({ note: 'first' })
    const second = draftOf({ note: 'second' })

    controller.change(first)
    controller.change(second)

    expect(timers.scheduler.clearTimeout).toHaveBeenCalledWith(1)
    expect(timers.ids()).toEqual([2])
    expect(latest).toBe(second)
    expect(save).not.toHaveBeenCalled()
    timers.run(2)
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(second)
  })

  it('flush and dispose cancel pending work and persist the latest draft', () => {
    const timers = schedulerFixture()
    let latest: EcommerceFormDraft | null = null
    const save = vi.fn()
    const controller = createEcommerceDraftAutoSaveController({
      save,
      scheduler: timers.scheduler,
      state: {
        getLatest: () => latest,
        setLatest: (draft) => {
          latest = draft
        },
      },
    })
    const first = draftOf({ note: 'first' })
    const second = draftOf({ note: 'second' })

    controller.change(first)
    controller.flush()
    expect(timers.scheduler.clearTimeout).toHaveBeenLastCalledWith(1)
    expect(save).toHaveBeenLastCalledWith(first)

    controller.change(second)
    controller.dispose()
    expect(timers.scheduler.clearTimeout).toHaveBeenLastCalledWith(2)
    expect(save).toHaveBeenLastCalledWith(second)
  })
})
