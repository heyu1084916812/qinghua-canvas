import { describe, expect, it, vi } from 'vitest'
import { sha1Bytes } from '../../../domain/shared/hash'
import type { EcommerceRequest } from '../../../domain/ecommerce/types'
import type { AssetPort, RowOf, StoragePort } from '../../../platform/ports'
import { createMemoryStorage } from '../../../platform/memory'
import { createEcommerceTaskRepository } from '../ecommerceTaskRepository'

const request: EcommerceRequest = {
  usage: 'set',
  platformId: 'amazon',
  language: 'en',
  count: 1,
  ratio: '1:1',
  productNodeId: 'node-product',
  referenceNodeIds: [],
  note: '',
  model: 'image-model',
}

const PUBLIC_ACTIONS = [
  'create',
  'appendResults',
  'updateResult',
  'commitAssets',
  'markRetrySave',
  'retrySave',
  'queuedSave',
  'result',
  'refreshTaskStatus',
  'setResultHidden',
  'updateTask',
  'removeResult',
  'interruptUnfinished',
  'results',
  'listResults',
  'reconcileFromRunRecords',
  'latestWithResults',
  'list',
  'remove',
] as const

describe('电商任务仓储 · 拆分前行为基线', () => {
  it('公共 action 名与参数默认值保持同一组', () => {
    const repo = createEcommerceTaskRepository(createMemoryStorage())
    expect(Object.keys(repo).sort()).toEqual([...PUBLIC_ACTIONS].sort())
    expect(repo.create.length).toBe(1)
    expect(repo.retrySave.length).toBe(1)
    expect(repo.interruptUnfinished.length).toBe(2)
  })

  it('800ms 防抖合并、flush 立即落库、旧写入不覆盖后到的编辑', async () => {
    vi.useFakeTimers()
    try {
      const writes: string[] = []
      const save = vi.fn(async (doc: { updatedAt: number; sourceText: string }) => {
        writes.push(doc.sourceText)
      })
      let timer: ReturnType<typeof setTimeout> | null = null
      let pending: { updatedAt: number; sourceText: string } | null = null
      let inFlight: Promise<void> | null = null
      let tail: Promise<void> = Promise.resolve()
      const flush = async () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        const doc = pending
        pending = null
      const task: Promise<void> | null = doc
          ? tail.catch(() => {}).then(() => save(doc))
          : inFlight
        if (doc && task) {
          inFlight = task
          tail = task.catch(() => {})
        }
        if (task) await task
      }
      const replace = (sourceText: string, updatedAt: number) => {
        pending = { sourceText, updatedAt }
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void flush(), 800)
      }

      replace('第一版', 100)
      await vi.advanceTimersByTimeAsync(799)
      expect(save).not.toHaveBeenCalled()
      replace('第二版', 200)
      await vi.advanceTimersByTimeAsync(799)
      expect(save).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0]?.[0].sourceText).toBe('第二版')

      replace('第三版', 300)
      await vi.advanceTimersByTimeAsync(799)
      replace('第四版', 400)
      await vi.advanceTimersByTimeAsync(1)
      expect(save).toHaveBeenCalledTimes(1)
      await flush()
      expect(save).toHaveBeenCalledTimes(2)
      expect(save.mock.calls[1]?.[0].sourceText).toBe('第四版')

      replace('第五版', 500)
      await flush()
      expect(writes).toEqual(['第二版', '第四版', '第五版'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('待入素材与重跑：成功只复用队列里的同一份字节，不触发生成端口', async () => {
    const storage = createMemoryStorage()
    const bytes = new Uint8Array([1, 2, 3])
    const hash = sha1Bytes(bytes).slice(0, 16)
    const assetWrites: string[] = []
    const wrappedStorage: StoragePort = {
      ...storage,
      async put(table, row) {
        if (table === 'assets') assetWrites.push(String(row.id))
        await storage.put(table, row)
      },
    }
    const generation = vi.fn().mockRejectedValue(new Error('不得重新请求模型'))
    const repo = createEcommerceTaskRepository(wrappedStorage)
    const created = await repo.create({
      projectId: 'p1',
      batchId: 'batch-retry-save',
      request,
      nodeIds: ['n1'],
      at: 100,
    })
    const resultId = created.results[0]!.id
    const queued = await repo.markRetrySave({
      resultId,
      planId: 'plan-1',
      prompt: '同一份提示词',
      model: 'image-model',
      assets: [{ hash, mime: 'image/png', bytes }],
      errorText: '写入失败',
      at: 110,
    })
    expect(queued).toMatchObject({ status: 'failed', recovery: 'retry-save' })
    expect(await repo.queuedSave(resultId)).toMatchObject({
      prompt: '同一份提示词',
      model: 'image-model',
      assets: [{ hash, mime: 'image/png', bytes }],
    })

    const outcome = await repo.retrySave(resultId, 120)

    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.result).toMatchObject({
      status: 'done',
      assetHash: hash,
      prompt: '同一份提示词',
      model: 'image-model',
    })
    expect(assetWrites).toEqual([hash])
    expect(await repo.queuedSave(resultId)).toBeNull()
    expect(generation).not.toHaveBeenCalled()
  })

  it('失败结果追加不覆盖旧图；并发重试时只有最新状态胜出', async () => {
    const storage = createMemoryStorage()
    const repo = createEcommerceTaskRepository(storage)
    const created = await repo.create({
      projectId: 'p1',
      batchId: 'batch-append-and-race',
      request: { ...request, count: 3 },
      nodeIds: ['n1', 'n2'],
      at: 100,
    })
    await repo.updateResult({
      ...created.results[0]!,
      status: 'done',
      assetHash: 'kept',
      updatedAt: 110,
    })
    const appended = await repo.appendResults(created.task.id, ['n2', 'n3', 'n3', 'n4'])
    expect(appended.results.slice(0, 2).map((row) => [row.nodeId, row.assetHash])).toEqual([
      ['n1', 'kept'],
      ['n2', undefined],
    ])
    expect(appended.results.map((row) => row.position)).toEqual([0, 1, 2, 3])

    const bytes = new Uint8Array([4, 5, 6])
    const hash = sha1Bytes(bytes).slice(0, 16)
    const racingAssets: AssetPort = {
      async read() {
        const [latest] = await storage.query('ecommerceResults', {
          id: created.results[1]!.id,
        })
        const racedRow: RowOf<'ecommerceResults'> = {
          ...(latest as Record<string, unknown>),
          id: created.results[1]!.id,
          status: 'running',
          updatedAt: 999,
        }
        await storage.put('ecommerceResults', racedRow)
        return { bytes, mime: 'image/png' }
      },
      async readUrl() {
        return null
      },
    }
    const racingRepo = createEcommerceTaskRepository(storage, racingAssets)
    await racingRepo.markRetrySave({
      resultId: created.results[1]!.id,
      planId: 'plan-race',
      prompt: '旧提示词',
      model: 'image-model',
      assets: [{ hash, mime: 'image/png', bytes }],
      errorText: '等待重试',
      at: 120,
    })
    const outcome = await racingRepo.retrySave(created.results[1]!.id, 130)
    expect(outcome.ok).toBe(false)
    expect(await racingRepo.result(created.results[1]!.id)).toMatchObject({
      status: 'running',
      updatedAt: 999,
    })
    expect(await racingRepo.queuedSave(created.results[1]!.id)).not.toBeNull()
  })
})
