import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { PlatformKit } from '../../platform/ports'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import { createStore } from '../../state/createStore'
import {
  forgetActiveCanvas,
  rememberActiveCanvas,
} from '../../state/project/activeCanvas'
import {
  canvasStoreFor,
  resetCanvasStoreCache,
} from '../../state/workbenches/canvas/storeCache'
import {
  NoActiveCanvasError,
  sendAssetToActiveCanvas,
} from './sendToActiveCanvas'

let platform: PlatformKit

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
  forgetActiveCanvas()
  resetCanvasStoreCache()
  platform = createMemoryPlatform()
})

describe('sendAssetToActiveCanvas', () => {
  it('没有当前画布时明确拒绝', async () => {
    await expect(
      sendAssetToActiveCanvas(platform, {
        hash: 'h1',
        mime: 'image/png',
        bytes: 3,
        savedAt: 1,
      }),
    ).rejects.toBeInstanceOf(NoActiveCanvasError)
  })

  it('把素材作为一个新节点写入当前画布并落库', async () => {
    rememberActiveCanvas('p1')
    await platform.storage.put('projects', {
      id: 'p1',
      name: '画布 A',
      workbench: 'canvas',
      createdAt: 1,
      updatedAt: 1,
      extra: {},
    } as never)
    await platform.storage.put('assets', {
      id: 'h1',
      hash: 'h1',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      width: 20,
      height: 10,
    } as never)

    const result = await sendAssetToActiveCanvas(platform, {
      hash: 'h1',
      mime: 'image/png',
      bytes: 3,
      width: 20,
      height: 10,
      savedAt: 1,
    })

    expect(result.projectId).toBe('p1')
    expect(result.projectName).toBe('画布 A')
    const nodes = await platform.storage.query('nodes', { projectId: 'p1' })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      id: result.nodeId,
      type: 'generation',
      data: { assetHash: 'h1', assetMime: 'image/png' },
    })
  })

  it('复用当前画布缓存并立即出现在原视口内，不要求刷新', async () => {
    rememberActiveCanvas('p1')
    await platform.storage.put('projects', {
      id: 'p1',
      name: '画布 A',
      workbench: 'canvas',
      createdAt: 1,
      updatedAt: 1,
      extra: {},
    } as never)
    await platform.storage.put('assets', {
      id: 'h2',
      hash: 'h2',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      width: 40,
      height: 20,
    } as never)

    const cached = canvasStoreFor('p1', () =>
      createStore({ workbench: 'canvas', platform, projectId: 'p1' }),
    )
    cached.store.hydrate({ projectId: 'p1', nodes: [], edges: [] })
    cached.store.setViewport({ x: 800, y: 600, zoom: 2 })
    cached.store.setSurfaceSize({ w: 1280, h: 800 })
    cached.hydrated = true

    const result = await sendAssetToActiveCanvas(platform, {
      hash: 'h2',
      mime: 'image/png',
      bytes: 3,
      width: 40,
      height: 20,
      savedAt: 1,
    })

    expect(canvasStoreFor('p1', () => {
      throw new Error('不应重建 store')
    }).store).toBe(cached.store)
    expect(cached.store.getSnapshot().nodes).toEqual([
      expect.objectContaining({
        id: result.nodeId,
        x: 928,
        y: 704,
      }),
    ])
  })
})
