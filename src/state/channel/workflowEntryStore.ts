import type { StoragePort } from '../../platform/ports'
import {
  normalizeWorkflowEntries,
  workflowEntriesRowId,
  type WorkflowEntry,
} from '../../domain/project/workflowParams'

/**
 * 工作流条目的读写（每个渠道一行，存 `presets` 表）。
 *
 * 复用 `presets` 的理由与 `cliToolStore` / 配方记忆同一条：它就是「按 id 存一条 JSON」，
 * 为此新建 Dexie schema（不可逆）不值得。行 id 由 `workflowEntriesRowId(channelId)` 给出，
 * **执行端与设置页读的是同一个字面量**（写在 domain 里，两边各写一份迟早漂移）。
 *
 * #1129 口径（审查 M7 / M12）：
 * - **读不到 ≠ 没有**：`load` 读失败会抛 `WorkflowEntryReadError`，不再回 `[]`——
 *   上一版回 `[]`，下一次整份 `save` 就把库里原有条目全部抹掉。
 * - **写失败会抛**：界面据此报错，不再提示「已导入」然后刷新就没了。
 * - **改条目走 `update`**：按渠道串行「读最新 → 改 → 写」，导入等待上游的 2–30 秒里
 *   改名 / 删除不会被导入完成时的整份覆盖吃掉；读失败时**不写**。
 * - `removeAll`：删渠道时把这一行一起清掉（M8：上一版留下孤儿行）。
 */
export class WorkflowEntryReadError extends Error {
  constructor(channelId: string, cause: unknown) {
    super(`读不到渠道 ${channelId} 的工作流条目：${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'WorkflowEntryReadError'
  }
}

export interface WorkflowEntryStore {
  load(channelId: string): Promise<WorkflowEntry[]>
  save(channelId: string, entries: readonly WorkflowEntry[]): Promise<void>
  /** 串行 load-modify-save；`fn` 收到的是库里**此刻**的条目 */
  update(channelId: string, fn: (entries: WorkflowEntry[]) => WorkflowEntry[]): Promise<WorkflowEntry[]>
  removeAll(channelId: string): Promise<void>
}

export function createWorkflowEntryStore(storage: StoragePort): WorkflowEntryStore {
  const queues = new Map<string, Promise<unknown>>()
  const serial = <T>(channelId: string, job: () => Promise<T>): Promise<T> => {
    const run = (queues.get(channelId) ?? Promise.resolve()).catch(() => undefined).then(job)
    queues.set(channelId, run)
    return run
  }
  const load = async (channelId: string): Promise<WorkflowEntry[]> => {
    let rows: unknown[]
    try {
      rows = await storage.query('presets', { id: workflowEntriesRowId(channelId) })
    } catch (e) {
      throw new WorkflowEntryReadError(channelId, e)
    }
    const row = rows[0] as { entries?: unknown } | undefined
    return normalizeWorkflowEntries(row?.entries)
  }
  const save = async (channelId: string, entries: readonly WorkflowEntry[]): Promise<void> => {
    await storage.put('presets', {
      id: workflowEntriesRowId(channelId),
      entries: entries.map((entry) => ({ ...entry })),
    } as never)
  }
  return {
    load,
    save: (channelId, entries) => serial(channelId, () => save(channelId, entries)),
    update: (channelId, fn) =>
      serial(channelId, async () => {
        const next = fn(await load(channelId))
        await save(channelId, next)
        return next
      }),
    removeAll: (channelId) => serial(channelId, () => storage.delete('presets', workflowEntriesRowId(channelId))),
  }
}
