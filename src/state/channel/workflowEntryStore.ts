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
 * 这里的 `save` 是**整份覆盖**：条目数量少、改动以"加一条 / 删一条 / 重新拉参数"为主，
 * 整份写天然原子，不会出现"新条目存进去了、旧条目没存进去"的半份状态。
 */
export interface WorkflowEntryStore {
  load(channelId: string): Promise<WorkflowEntry[]>
  save(channelId: string, entries: readonly WorkflowEntry[]): Promise<void>
}

export function createWorkflowEntryStore(storage: StoragePort): WorkflowEntryStore {
  return {
    async load(channelId) {
      try {
        const rows = await storage.query('presets', { id: workflowEntriesRowId(channelId) })
        const row = rows[0] as { entries?: unknown } | undefined
        return normalizeWorkflowEntries(row?.entries)
      } catch {
        /* 表可能不存在（极老的库）；读失败当"没有条目"，别把设置页卡住 */
        return []
      }
    },
    async save(channelId, entries) {
      try {
        await storage.put('presets', {
          id: workflowEntriesRowId(channelId),
          entries: entries.map((entry) => ({ ...entry })),
        } as never)
      } catch {
        /* 与配方 / 技能同一口径：偏好写不进不打断主流程 */
      }
    },
  }
}
