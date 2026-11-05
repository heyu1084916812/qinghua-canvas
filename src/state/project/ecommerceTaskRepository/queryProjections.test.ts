import { describe, expect, it } from 'vitest'
import type { EcommerceResultRecord, EcommerceTaskRecord } from '../../../domain/ecommerce/tasks'
import {
  hashesToVerify,
  hiddenResult,
  interruptResults,
  interruptedTask,
  latestRunByNode,
  latestTasks,
  projectResults,
  reconciledResult,
  reconciledTasks,
  refreshedTask,
  resultRemovable,
  resultsByPosition,
} from './queryProjections'

const result = (id: string, overrides: Partial<EcommerceResultRecord> = {}): EcommerceResultRecord => ({
  id,
  taskId: 't1',
  projectId: 'p1',
  nodeId: id,
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  status: 'pending',
  ...overrides,
})

const task = (overrides: Partial<EcommerceTaskRecord> = {}): EcommerceTaskRecord => ({
  id: 't1',
  projectId: 'p1',
  batchId: 'b1',
  createdAt: 1,
  updatedAt: 1,
  status: 'running',
  request: {} as EcommerceTaskRecord['request'],
  nodeIds: ['r1'],
  ...overrides,
})

describe('电商仓储 · 查询与迁移投影', () => {
  it('稳定排序、隐藏字段、刷新状态和中断收口', () => {
    const rows = [
      result('r1', { position: 2 }),
      result('r2', { position: 0, createdAt: 3 }),
      result('r3', { position: 1, createdAt: 0 }),
    ]
    expect(resultsByPosition(rows).map((row) => row.id)).toEqual(['r2', 'r3', 'r1'])
    expect(projectResults(rows).map((row) => row.id)).toEqual(['r3', 'r1', 'r2'])
    expect(latestTasks([task({ id: 'old', createdAt: 1 }), task({ id: 'new', createdAt: 2 })])[0]?.id).toBe('new')
    expect(hiddenResult(result('r1'), true, 20)).toMatchObject({ hiddenAt: 20 })
    expect('hiddenAt' in hiddenResult(result('r1', { hiddenAt: 20 }), false, 30)).toBe(false)
    expect(refreshedTask(task(), [result('r1', { status: 'done' })], 40).status).toBe('done')

    const runs = latestRunByNode([
      { nodeId: 'r1', createdAt: 1, status: 'failed', errorText: '旧错误' },
      { nodeId: 'r1', createdAt: 2, status: 'failed', errorText: '最新错误' },
    ])
    const interrupted = interruptResults(rows, runs, '中断', 50)
    expect(interrupted[0]).toMatchObject({ status: 'failed', errorText: '最新错误', updatedAt: 50 })
    expect(interruptedTask(task(), interrupted, '中断', 50).errorText).toBe('最新错误')
    expect(resultRemovable(result('r1', { status: 'running' }), [{ status: 'failed', createdAt: 2 }])).toBe(true)
    expect(resultRemovable(result('r1', { status: 'done' }), [{ status: 'succeeded', createdAt: 2 }])).toBe(false)
  })

  it('RunRecord 对账：无产物失败、缺字节 retry-save、成功回填并同步任务', () => {
    const pending = result('r1')
    const failed = reconciledResult(pending, {
      run: { status: 'failed', errorText: '上游 500', createdAt: 2 },
      hashIsReadable: () => true,
      at: 60,
    })
    expect(failed).toMatchObject({ status: 'failed', errorText: '上游 500' })

    const queued = {
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
      errorText: '字节缺失',
    }
    const retrySave = reconciledResult(pending, {
      run: { status: 'succeeded', outputHashes: ['h1'], createdAt: 2 },
      hashIsReadable: () => false,
      queued,
      at: 60,
    })
    expect(retrySave).toMatchObject({ status: 'failed', recovery: 'retry-save', errorText: '字节缺失' })

    const done = reconciledResult(pending, {
      run: {
        status: 'succeeded',
        outputHashes: ['h1'],
        createdAt: 2,
        sentModel: 'image-model',
        outputWidth: 64,
        outputHeight: 64,
      },
      hashIsReadable: () => true,
      at: 60,
    })
    expect(done).toMatchObject({
      status: 'done',
      assetHash: 'h1',
      model: 'image-model',
      width: 64,
      height: 64,
    })
    const projection = reconciledTasks([task()], [done], [done], 60)
    expect(projection.next[0]?.status).toBe('done')
    expect(projection.changed).toHaveLength(1)
    expect(hashesToVerify([result('r1', { status: 'done', assetHash: 'old' })], new Map()).has('old')).toBe(true)
  })
})
