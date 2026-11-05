import { describe, expect, it } from 'vitest'
import { resultMetadataOf } from '../../../domain/ecommerce/tasks'
import { firstOutputHashOf, queuedSaveOf, resultOf, taskOf } from './rowMappers'

describe('电商仓储 · 行映射', () => {
  it('任务行与结果行只保留合法字段；坏状态回落，非空来源字段可往返', () => {
    const task = taskOf({
      id: 'task-1',
      projectId: 'p1',
      batchId: 'batch-1',
      createdAt: 'bad',
      updatedAt: 12,
      status: 'unknown',
      request: { usage: 'set' },
      nodeIds: [1, 'n2'],
      sourceTaskId: 'source-task',
      sourceResultId: '',
      sourceAssetHash: 'source-hash',
      errorText: '失败',
    })
    expect(task).toMatchObject({
      status: 'failed',
      createdAt: 0,
      nodeIds: ['1', 'n2'],
      sourceTaskId: 'source-task',
      sourceAssetHash: 'source-hash',
    })
    expect('sourceResultId' in task).toBe(false)

    const result = resultOf({
      id: 'result-1',
      taskId: 'task-1',
      projectId: 'p1',
      nodeId: 'n1',
      position: 2,
      status: 'running',
      assetHash: 'hash',
      mime: 'image/png',
      hiddenAt: Number.NaN,
      width: 64,
      height: 'bad',
      prompt: '提示词',
      model: 'model',
      recovery: 'retry-save',
      shotTitle: '主图',
      brief: '卖点',
      ratio: '1:1',
      headline: '标题',
      subheadline: '副标题',
      visualSystem: '视觉系统',
    })
    expect(result).toMatchObject({
      status: 'running',
      recovery: 'retry-save',
      width: 64,
      ...resultMetadataOf({
        shotTitle: '主图',
        brief: '卖点',
        ratio: '1:1',
        headline: '标题',
        subheadline: '副标题',
        visualSystem: '视觉系统',
      }),
    })
    expect('hiddenAt' in result).toBe(false)
    expect('height' in result).toBe(false)
  })

  it('恢复队列与 RunRecord 输出只认第一份合法产物', () => {
    const bytes = new Uint8Array([1])
    const queued = queuedSaveOf({
      id: 'result-1',
      projectId: 'p1',
      resultId: 'result-1',
      assets: [{ hash: 'h1', mime: 'image/png', bytes }],
      createdAt: 10,
      updatedAt: 11,
      errorText: '保存失败',
    })
    expect(queued.assets).toEqual([{ hash: 'h1', mime: 'image/png', bytes }])
    expect(queuedSaveOf({ id: 'result-2', assets: 'bad' }).assets).toEqual([])
    expect(firstOutputHashOf({ outputHashes: ['', 'first', 'second'] })).toBe('first')
    expect(firstOutputHashOf({ outputHashes: 'bad' })).toBeUndefined()
  })
})
