import { describe, expect, it } from 'vitest'
import type { EcommerceResultRecord } from '../../../domain/ecommerce/tasks'
import {
  doneRetrySave,
  failedRetrySave,
  primaryAssetFields,
  queuedSaveFor,
  retrySaveBlocksWrite,
  withoutResultAttempt,
} from './retrySaveProjections'
import type { QueuedAssetSave } from './types'

const base: EcommerceResultRecord = {
  id: 'r1',
  taskId: 't1',
  projectId: 'p1',
  nodeId: 'n1',
  position: 0,
  createdAt: 1,
  updatedAt: 10,
  status: 'failed',
  recovery: 'retry-save',
  assetHash: 'old',
  mime: 'image/png',
  width: 10,
  errorText: '旧错误',
}

const queue: QueuedAssetSave = {
  id: 'r1',
  projectId: 'p1',
  resultId: 'r1',
  taskId: 't1',
  planId: 'plan',
  prompt: '提示词',
  model: 'model',
  assets: [{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }],
  createdAt: 10,
  updatedAt: 10,
}

describe('电商仓储 · 待入素材与重跑投影', () => {
  it('markRetrySave 同时生成 failed 结果与原样字节队列，不保留旧产物字段', () => {
    const projected = queuedSaveFor(base, {
      planId: 'plan',
      prompt: '提示词',
      model: 'model',
      assets: queue.assets,
      errorText: '写入失败',
      at: 20,
    })
    expect(projected.result).toMatchObject({
      status: 'failed',
      recovery: 'retry-save',
      prompt: '提示词',
      model: 'model',
      errorText: '写入失败',
      updatedAt: 20,
    })
    for (const key of ['assetHash', 'mime', 'width'] as const) {
      expect(key in projected.result).toBe(false)
    }
    expect(projected.queued.assets).toEqual(queue.assets)
    expect(withoutResultAttempt(base)).not.toHaveProperty('errorText')
  })

  it('状态或队列 revision 已变化时阻止旧句柄覆盖；成功投影复用队列元数据', () => {
    expect(retrySaveBlocksWrite(base, queue, base, queue)).toBe(false)
    expect(retrySaveBlocksWrite({ ...base, status: 'running' }, queue, base, queue)).toBe(true)
    expect(retrySaveBlocksWrite(base, { ...queue, updatedAt: 999 }, base, queue)).toBe(true)
    expect(retrySaveBlocksWrite(undefined, queue, base, queue)).toBe(true)

    const done = doneRetrySave(
      base,
      queue,
      { hash: 'h1', mime: 'video/mp4', width: 1280, height: 720 },
      30,
    )
    expect(done).toMatchObject({
      status: 'done',
      prompt: '提示词',
      model: 'model',
      assetHash: 'h1',
      mime: 'video/mp4',
      width: 1280,
      height: 720,
      updatedAt: 30,
    })
    expect('recovery' in done).toBe(false)
    expect('errorText' in done).toBe(false)
    expect(primaryAssetFields(undefined)).toEqual({})
    expect(failedRetrySave(base, '再次失败', 40)).toMatchObject({
      status: 'failed',
      recovery: 'retry-save',
      errorText: '再次失败',
      updatedAt: 40,
    })
  })
})
