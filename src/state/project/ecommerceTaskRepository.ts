import type { AssetPort, StoragePort } from '../../platform/ports'
import {
  assetHashIsReadable,
  createStorageAssetPort,
  putGeneratedAssets,
} from '../../platform/assets'
import { createId } from '../../shared/id'
import {
  taskStatusOf,
  resultMetadataOf,
  type EcommerceResultRecord,
  type EcommerceResultMetadata,
  type EcommerceTaskRecord,
} from '../../domain/ecommerce/tasks'
import type { EcommerceRequest } from '../../domain/ecommerce/types'
import type { GeneratedAsset } from '../../platform/channels/types'
import type { QueuedAssetSave, RetryAssetSaveResult } from './ecommerceTaskRepository/types'
import {
  queuedSaveRows,
  resultRows as mapResultRows,
  taskRows as mapTaskRows,
} from './ecommerceTaskRepository/rowMappers'
import {
  doneRetrySave,
  failedRetrySave,
  primaryAssetFields,
  queuedSaveFor,
  retrySaveBlocksWrite,
  withoutResultAttempt,
  withoutResultFailure,
} from './ecommerceTaskRepository/retrySaveProjections'
import {
  hashesToVerify,
  hiddenResult,
  interruptResults,
  interruptedTask,
  latestRunByNode,
  latestTasks,
  listedTasks,
  projectResults,
  queuedSaveByResult,
  reconciledResult,
  reconciledTasks,
  refreshedTask,
  resultRemovable,
  resultsByPosition,
} from './ecommerceTaskRepository/queryProjections'

export type { QueuedAssetSave, RetryAssetSaveResult } from './ecommerceTaskRepository/types'

/**
 * 电商任务 / 结果的持久化仓储（对账 #399 第二期）。
 *
 * 这里是电商工作区自己的结果真源：结果展示读这两张表，
 * 画布节点只作为内部执行载体，不再由界面直接拿节点反推"这一批出过什么"。
 */
export interface EcommerceTaskRepository {
  create(input: {
    projectId: string
    batchId: string
    request: EcommerceRequest
    nodeIds: readonly string[]
    metadata?: readonly EcommerceResultMetadata[]
    sourceTaskId?: string
    sourceResultId?: string
    sourceAssetHash?: string
    at?: number
  }): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
  appendResults(
    taskId: string,
    nodeIds: readonly string[],
    metadata?: readonly EcommerceResultMetadata[],
  ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] }>
  updateResult(result: EcommerceResultRecord): Promise<void>
  /**
   * 正常提交的唯一落库入口：写素材、读回校验、再置 done。
   *
   * 任一步失败都会留下 retry-save 句柄；不会把只有主键或损坏字节的结果标完成。
   */
  commitAssets(input: {
    resultId: string
    planId: string
    prompt: string
    model: string
    assets: readonly GeneratedAsset[]
    at?: number
  }): Promise<RetryAssetSaveResult>
  /**
   * 模型已成功、素材写入失败时，把同一份产物存进内部恢复队列并把结果切到
   * `failed + retry-save`。后续只能重试保存，不能重新请求模型。
   */
  markRetrySave(input: {
    resultId: string
    planId: string
    prompt: string
    model: string
    assets: readonly GeneratedAsset[]
    errorText: string
    at?: number
  }): Promise<EcommerceResultRecord | null>
  /** 从内部恢复队列重试同一份产物；成功后才清队列。 */
  retrySave(resultId: string, at?: number): Promise<RetryAssetSaveResult>
  /** 只给诊断与单测使用：查看内部恢复句柄是否真的持久化。 */
  queuedSave(resultId: string): Promise<QueuedAssetSave | null>
  result(resultId: string): Promise<EcommerceResultRecord | null>
  refreshTaskStatus(taskId: string, at?: number): Promise<EcommerceTaskRecord | null>
  setResultHidden(resultId: string, hidden: boolean, at?: number): Promise<void>
  updateTask(task: EcommerceTaskRecord): Promise<void>
  removeResult(
    resultId: string,
    at?: number,
  ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] } | null>
  interruptUnfinished(
    taskId: string,
    reason: string,
    at?: number,
  ): Promise<{ task: EcommerceTaskRecord; results: EcommerceResultRecord[] } | null>
  results(taskId: string): Promise<EcommerceResultRecord[]>
  /** 整个项目的逐格结果，供无限工作台按任务与 position 回填空间布局。 */
  listResults(projectId: string): Promise<EcommerceResultRecord[]>
  /**
   * 用 RunRecord 的终态 reconcile 电商结果与任务。
   *
   * 执行宿主会在 `runNode` 返回前清掉内存状态，因此只读 `nodeStateOf()` 会把
   * 已失败的 API 调用永久留在 running。RunRecord 是每次调用的持久事实源。
   */
  reconcileFromRunRecords(
    projectId: string,
    at?: number,
  ): Promise<{ results: EcommerceResultRecord[]; tasks: EcommerceTaskRecord[] }>
  latestWithResults(projectId: string): Promise<{
    task: EcommerceTaskRecord
    results: EcommerceResultRecord[]
  } | null>
  list(projectId: string): Promise<EcommerceTaskRecord[]>
  remove(taskId: string): Promise<void>
}

const resultOf = (row: Record<string, unknown>) => mapResultRows([row])[0]!
const taskOf = (row: Record<string, unknown>) => mapTaskRows([row])[0]!
const queuedSaveOf = (row: Record<string, unknown>) => queuedSaveRows([row])[0]!

export function createEcommerceTaskRepository(
  storage: StoragePort,
  assets: AssetPort = createStorageAssetPort(storage),
): EcommerceTaskRepository {
  const putAssets = async (
    projectId: string,
    queuedAssets: readonly GeneratedAsset[],
    at: number,
  ) => {
    await putGeneratedAssets(storage, assets, projectId, queuedAssets, at)
  }

  const resultsOf = async (taskId: string) =>
    resultsByPosition(
      mapResultRows(
        (await storage.query('ecommerceResults', {
          taskId,
        })) as unknown as Record<string, unknown>[],
      ),
    )

  return {
    async create({
      projectId,
      batchId,
      request,
      nodeIds,
      metadata,
      sourceTaskId,
      sourceResultId,
      sourceAssetHash,
      at = Date.now(),
    }) {
      const taskId = createId('ect')
      const task: EcommerceTaskRecord = {
        id: taskId,
        projectId,
        batchId,
        createdAt: at,
        updatedAt: at,
        status: 'running',
        request,
        nodeIds: [...nodeIds],
        ...(sourceTaskId ? { sourceTaskId } : {}),
        ...(sourceResultId ? { sourceResultId } : {}),
        ...(sourceAssetHash ? { sourceAssetHash } : {}),
      }
      const results: EcommerceResultRecord[] = nodeIds.map((nodeId, position) => ({
        id: createId('ecr'),
        taskId,
        projectId,
        nodeId,
        position,
        createdAt: at,
        updatedAt: at,
        status: 'pending',
        ...resultMetadataOf(metadata?.[position] ?? {}),
      }))
      await storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        await tx.put('ecommerceTasks', task as never)
        await tx.bulkPut('ecommerceResults', results as never)
      })
      return { task, results }
    },

    async updateResult(result) {
      await storage.put('ecommerceResults', result as never)
    },

    async commitAssets({
      resultId,
      planId,
      prompt,
      model,
      assets: nextAssets,
      at = Date.now(),
    }) {
      const current = await this.result(resultId)
      const primary = nextAssets[0]
      if (!current) {
        return {
          ok: false,
          result: null,
          errorText: `电商结果不存在：${resultId}`,
        }
      }
      if (!primary) {
        return {
          ok: false,
          result: current,
          errorText: '生成成功但没有返回可落库的产物',
        }
      }
      try {
        await putAssets(current.projectId, nextAssets, at)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        let failed: EcommerceResultRecord | null = null
        try {
          failed = await this.markRetrySave({
            resultId,
            planId,
            prompt,
            model,
            assets: nextAssets,
            errorText: `生成已成功，但素材保存失败：${reason}。请重试保存结果，不要重新生成。`,
            at,
          })
        } catch (recoveryError) {
          failed = {
            ...withoutResultAttempt(current),
            status: 'failed',
            prompt,
            model,
            errorText:
              `生成已成功，但素材保存失败：${reason}；` +
              `恢复句柄也写入失败：${
                recoveryError instanceof Error
                  ? recoveryError.message
                  : String(recoveryError)
              }`,
            updatedAt: at,
          }
          await this.updateResult(failed)
        }
        return {
          ok: false,
          result: failed,
          errorText: `素材保存失败：${reason}`,
        }
      }

      const done: EcommerceResultRecord = {
        ...withoutResultFailure(current),
        status: 'done',
        ...primaryAssetFields(primary),
        prompt,
        model,
        updatedAt: at,
      }
      try {
        await this.updateResult(done)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        let failed: EcommerceResultRecord | null = null
        try {
          failed = await this.markRetrySave({
            resultId,
            planId,
            prompt,
            model,
            assets: nextAssets,
            errorText: `素材已保存，但结果状态写入失败：${reason}。请重试保存结果。`,
            at,
          })
        } catch {
          failed = {
            ...current,
            status: 'failed',
            prompt,
            model,
            errorText: `素材已保存，但结果状态写入失败：${reason}`,
            updatedAt: at,
          }
          await this.updateResult(failed)
        }
        return {
          ok: false,
          result: failed,
          errorText: `结果状态写入失败：${reason}`,
        }
      }
      return { ok: true, result: done }
    },

    async markRetrySave({
      resultId,
      planId,
      prompt,
      model,
      assets: queuedAssets,
      errorText,
      at = Date.now(),
    }) {
      const rows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      const row = rows.map(resultOf)[0]
      if (!row) return null
      const { result: next, queued } = queuedSaveFor(row, {
        planId,
        prompt,
        model,
        assets: queuedAssets,
        errorText,
        at,
      })
      await storage.transaction(
        ['assetSaveQueue', 'ecommerceResults'],
        async (tx) => {
          await tx.put('assetSaveQueue', queued as never)
          await tx.put('ecommerceResults', next as never)
        },
      )
      return next
    },

    async retrySave(resultId, at = Date.now()) {
      const queued = await this.queuedSave(resultId)
      const current = await this.result(resultId)
      if (!queued || !current) {
        return {
          ok: false,
          result: current,
          errorText: '没有找到可恢复的保存句柄，请查看运行日志',
        }
      }
      try {
        await putAssets(queued.projectId, queued.assets, at)
      } catch (error) {
        const message = `重试保存失败：${error instanceof Error ? error.message : String(error)}`
        let outcome: RetryAssetSaveResult = {
          ok: false,
          result: current,
          errorText: message,
        }
        await storage.transaction(
          ['assetSaveQueue', 'ecommerceResults'],
          async (tx) => {
            const resultRows = await tx.query('ecommerceResults', {
              id: resultId,
            })
            const queueRows = await tx.query('assetSaveQueue', { resultId })
            const latest = (resultRows as unknown as Record<string, unknown>[])
              .map(resultOf)[0]
            const latestQueue = (queueRows as unknown as Record<string, unknown>[])
              .map(queuedSaveOf)[0]
            if (retrySaveBlocksWrite(latest, latestQueue, current, queued)) {
              outcome = {
                ok: false,
                result: latest ?? null,
                errorText: '结果状态已变化，旧恢复句柄已停止写入',
              }
              return
            }
            const failed = failedRetrySave(latest!, message, at)
            await tx.put(
              'assetSaveQueue',
              { ...latestQueue, updatedAt: at, errorText: message } as never,
            )
            await tx.put('ecommerceResults', failed as never)
            outcome = { ok: false, result: failed, errorText: message }
          },
        )
        return outcome
      }
      const primary = queued.assets[0]
      let outcome: RetryAssetSaveResult = {
        ok: false,
        result: current,
        errorText: '结果状态已变化，旧恢复句柄已停止写入',
      }
      await storage.transaction(
        ['assetSaveQueue', 'ecommerceResults'],
        async (tx) => {
          const resultRows = await tx.query('ecommerceResults', {
            id: resultId,
          })
          const queueRows = await tx.query('assetSaveQueue', { resultId })
          const latest = (resultRows as unknown as Record<string, unknown>[])
            .map(resultOf)[0]
          const latestQueue = (queueRows as unknown as Record<string, unknown>[])
            .map(queuedSaveOf)[0]
          if (retrySaveBlocksWrite(latest, latestQueue, current, queued)) {
            outcome = {
              ok: false,
              result: latest ?? null,
              errorText: '结果状态已变化，旧恢复句柄已停止写入',
            }
            return
          }
          const done = doneRetrySave(latest!, latestQueue!, primary, at)
          await tx.put('ecommerceResults', done as never)
          await tx.delete('assetSaveQueue', resultId)
          outcome = { ok: true, result: done }
        },
      )
      if (outcome.ok && outcome.result) {
        await this.refreshTaskStatus(outcome.result.taskId, at)
      }
      return outcome
    },

    async queuedSave(resultId) {
      const rows = (await storage.query('assetSaveQueue', {
        resultId,
      })) as unknown as Record<string, unknown>[]
      return rows.map(queuedSaveOf)[0] ?? null
    },

    async result(resultId) {
      const rows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      return rows.map(resultOf)[0] ?? null
    },

    async refreshTaskStatus(taskId, at = Date.now()) {
      const taskRows = (await storage.query('ecommerceTasks', {
        id: taskId,
      })) as unknown as Record<string, unknown>[]
      const task = taskRows.map(taskOf)[0]
      if (!task) return null
      const rows = await resultsOf(taskId)
      const next = refreshedTask(task, rows, at)
      await storage.put('ecommerceTasks', next as never)
      return next
    },

    async setResultHidden(resultId, hidden, at = Date.now()) {
      const rows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      const row = rows.map(resultOf)[0]
      if (!row) return
      await storage.put(
        'ecommerceResults',
        hiddenResult(row, hidden, at) as never,
      )
    },

    async appendResults(taskId, nodeIds, metadata) {
      const taskRows = (await storage.query('ecommerceTasks', { id: taskId })) as unknown as Record<
        string,
        unknown
      >[]
      const task = taskRows.map(taskOf)[0]
      if (!task) throw new Error(`电商任务不存在：${taskId}`)
      const existing = await resultsOf(taskId)
      const currentIds = new Set(task.nodeIds)
      const appendedIds = [...new Set(nodeIds)].filter((id) => id && !currentIds.has(id))
      const at = Date.now()
      const start = existing.reduce((max, row) => Math.max(max, row.position), -1) + 1
      const appended: EcommerceResultRecord[] = appendedIds.map((nodeId, offset) => {
        const sourceIndex = nodeIds.indexOf(nodeId)
        return {
          id: createId('ecr'),
          taskId,
          projectId: task.projectId,
          nodeId,
          position: start + offset,
          createdAt: at,
          updatedAt: at,
          status: 'pending',
          ...resultMetadataOf(metadata?.[sourceIndex >= 0 ? sourceIndex : offset] ?? {}),
        }
      })
      const nextTask: EcommerceTaskRecord = {
        ...task,
        updatedAt: at,
        status: appended.length > 0 ? 'running' : task.status,
        nodeIds: [...task.nodeIds, ...appendedIds],
      }
      await storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        await tx.put('ecommerceTasks', nextTask as never)
        if (appended.length > 0) await tx.bulkPut('ecommerceResults', appended as never)
      })
      return { task: nextTask, results: [...existing, ...appended] }
    },

    async updateTask(task) {
      await storage.put('ecommerceTasks', task as never)
    },

    async removeResult(resultId, at = Date.now()) {
      /**
       * 结果行可能因为执行宿主在 `runNode` 收尾前清掉内存态而停在 running；
       * 此时界面依据 RunRecord 已显示失败，但用户点“移除记录”会被旧的
       * running 状态挡住，下一次 sync 又把它带回来。以最近一次 RunRecord
       * 的 failed / canceled 作为第二个可删除判据。
       */
      const beforeRows = (await storage.query('ecommerceResults', {
        id: resultId,
      })) as unknown as Record<string, unknown>[]
      const before = beforeRows.map(resultOf)[0]
      if (!before) return null
      const runRows = (
        (await storage.query('runRecords', {
          projectId: before.projectId,
          nodeId: before.nodeId,
        })) as unknown as Record<string, unknown>[]
      )
      if (!resultRemovable(before, runRows)) return null
      return storage.transaction(
        ['ecommerceTasks', 'ecommerceResults', 'assetSaveQueue'],
        async (tx) => {
          const resultRows = (await tx.query('ecommerceResults', {
            id: resultId,
          })) as unknown as Record<string, unknown>[]
          const target = resultRows.map(resultOf)[0]
          if (!target) return null
          const taskRows = (await tx.query('ecommerceTasks', {
            id: target.taskId,
          })) as unknown as Record<string, unknown>[]
          const task = taskRows.map(taskOf)[0]
          if (!task) return null
          await tx.delete('ecommerceResults', resultId)
          await tx.delete('assetSaveQueue', resultId)
          const remaining = (
            (await tx.query('ecommerceResults', {
              taskId: task.id,
            })) as unknown as Record<string, unknown>[]
          )
            .map(resultOf)
            .sort((a, b) => a.position - b.position)
          const nextTask: EcommerceTaskRecord = {
            ...task,
            updatedAt: at,
            status: taskStatusOf(remaining),
            nodeIds: remaining.map((row) => row.nodeId),
          }
          delete nextTask.errorText
          await tx.put('ecommerceTasks', nextTask as never)
          return { task: nextTask, results: remaining }
        },
      )
    },

    async interruptUnfinished(taskId, reason, at = Date.now()) {
      const previewRows = (await storage.query('ecommerceTasks', {
        id: taskId,
      })) as unknown as Record<string, unknown>[]
      const preview = previewRows.map(taskOf)[0]
      const runRows = preview
        ? ((await storage.query('runRecords', {
            projectId: preview.projectId,
          })) as unknown as Record<string, unknown>[])
        : []
      const runsByNode = latestRunByNode(runRows)
      return storage.transaction(['ecommerceTasks', 'ecommerceResults'], async (tx) => {
        const taskRows = (await tx.query('ecommerceTasks', { id: taskId })) as unknown as Record<
          string,
          unknown
        >[]
        const task = taskRows.map(taskOf)[0]
        if (!task || task.status !== 'running') return null
        const rows = (await tx.query('ecommerceResults', {
          taskId,
        })) as unknown as Record<string, unknown>[]
        const results = interruptResults(resultsByPosition(rows.map(resultOf)), runsByNode, reason, at)
        const nextTask = interruptedTask(task, results, reason, at)
        await tx.put('ecommerceTasks', nextTask as never)
        await tx.bulkPut('ecommerceResults', results as never)
        return { task: nextTask, results }
      })
    },

    results: resultsOf,

    async reconcileFromRunRecords(projectId, at = Date.now()) {
      const [taskRows, resultRows, runRows, queueRows] = await Promise.all([
        storage.query('ecommerceTasks', { projectId }),
        storage.query('ecommerceResults', { projectId }),
        storage.query('runRecords', { projectId }),
        storage.query('assetSaveQueue', { projectId }),
      ])
      const tasks = mapTaskRows(taskRows as unknown as Record<string, unknown>[])
      const results = mapResultRows(resultRows as unknown as Record<string, unknown>[])
      const queuedByResult = queuedSaveByResult(
        queuedSaveRows(queueRows as unknown as Record<string, unknown>[]),
      )
      const latestByNode = latestRunByNode(runRows as unknown as Record<string, unknown>[])
      const outputHashesToVerify = hashesToVerify(results, latestByNode)
      const readableHashes = new Set<string>()
      for (const hash of outputHashesToVerify) {
        if (await assetHashIsReadable(assets, hash)) readableHashes.add(hash)
      }
      const changed: EcommerceResultRecord[] = []
      const nextResults = results.map((row) => {
        const next = reconciledResult(row, {
          run: latestByNode.get(row.nodeId),
          hashIsReadable: (hash) => readableHashes.has(hash),
          queued: queuedByResult.get(row.id),
          at,
        })
        if (next === row) return row
        changed.push(next)
        return next
      })
      const projection = reconciledTasks(tasks, nextResults, changed, at)
      const nextTasks = projection.next
      const changedTasks = projection.changed
      await storage.transaction(['ecommerceResults', 'ecommerceTasks'], async (tx) => {
        if (changed.length > 0) await tx.bulkPut('ecommerceResults', changed as never)
        if (changedTasks.length > 0) await tx.bulkPut('ecommerceTasks', changedTasks as never)
      })
      return { results: nextResults, tasks: nextTasks }
    },

    async listResults(projectId) {
      return projectResults(
        mapResultRows(
          (await storage.query('ecommerceResults', {
            projectId,
          })) as unknown as Record<string, unknown>[],
        ),
      )
    },

    async latestWithResults(projectId) {
      const rows = (await storage.query('ecommerceTasks', { projectId })) as unknown as Record<
        string,
        unknown
      >[]
      const tasks = latestTasks(mapTaskRows(rows))
      for (const task of tasks) {
        const results = await resultsOf(task.id)
        if (results.length > 0) return { task, results }
      }
      return null
    },

    async list(projectId) {
      const rows = (await storage.query('ecommerceTasks', { projectId })) as unknown as Record<
        string,
        unknown
      >[]
      return listedTasks(mapTaskRows(rows))
    },

    async remove(taskId) {
      await storage.transaction(
        ['ecommerceTasks', 'ecommerceResults', 'assetSaveQueue'],
        async (tx) => {
        await tx.delete('ecommerceTasks', taskId)
        const rows = await tx.query('ecommerceResults', { taskId })
        for (const row of rows) await tx.delete('ecommerceResults', row.id)
          const queued = await tx.query('assetSaveQueue', { taskId })
          for (const row of queued) await tx.delete('assetSaveQueue', row.id)
        },
      )
    },
  }
}
