import type { StoragePort } from '../../platform/ports'
import type {
  ReferenceAssetRef,
  ReferenceItem,
  ReferenceSelection,
  ReferenceUsage,
} from '../../domain/project/referenceLedger'
import { selectReferencesForTask } from '../../domain/project/referenceLedger'

/** 项目参考台账仓储：按 projectId 隔离，素材字节仍只在 assets 表。 */
export interface ReferenceLedgerRepository {
  listItems(projectId: string): Promise<ReferenceItem[]>
  listUsages(projectId: string, taskKey?: string): Promise<ReferenceUsage[]>
  putItem(item: ReferenceItem): Promise<void>
  putUsage(usage: ReferenceUsage): Promise<void>
  removeItem(projectId: string, id: string): Promise<void>
  selectForTask(projectId: string, taskKey: string): Promise<ReferenceSelection>
}

function assetsOf(value: unknown): ReferenceAssetRef[] {
  if (!Array.isArray(value)) return []
  const rows: ReferenceAssetRef[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const row = candidate as Record<string, unknown>
    if (
      typeof row.hash !== 'string' ||
      !row.hash ||
      (row.role !== 'logo' && row.role !== 'reference')
    ) continue
    rows.push({
      hash: row.hash,
      role: row.role,
      name: typeof row.name === 'string' ? row.name : '',
    })
  }
  return rows
}

function itemOf(row: Record<string, unknown>): ReferenceItem | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.projectId !== 'string' ||
    typeof row.title !== 'string' ||
    typeof row.source !== 'string' ||
    typeof row.kind !== 'string' ||
    typeof row.what !== 'string' ||
    typeof row.createdAt !== 'number' ||
    typeof row.updatedAt !== 'number'
  ) return null
  const assets = assetsOf(row.assets)
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    source: row.source as ReferenceItem['source'],
    kind: row.kind as ReferenceItem['kind'],
    ...(typeof row.assetHash === 'string' ? { assetHash: row.assetHash } : {}),
    ...(assets.length > 0 ? { assets } : {}),
    ...(typeof row.url === 'string' ? { url: row.url } : {}),
    ...(typeof row.kitId === 'string' ? { kitId: row.kitId } : {}),
    ...(typeof row.kitVersion === 'number' ? { kitVersion: row.kitVersion } : {}),
    what: row.what,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function usageOf(row: Record<string, unknown>): ReferenceUsage | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.itemId !== 'string' ||
    typeof row.projectId !== 'string' ||
    typeof row.taskKey !== 'string' ||
    typeof row.usage !== 'string' ||
    typeof row.howToUse !== 'string' ||
    typeof row.createdAt !== 'number'
  ) return null
  return {
    id: row.id,
    itemId: row.itemId,
    projectId: row.projectId,
    taskKey: row.taskKey,
    usage: row.usage as ReferenceUsage['usage'],
    howToUse: row.howToUse,
    ...(row.identityAnchor === true ? { identityAnchor: true } : {}),
    createdAt: row.createdAt,
  }
}

export function createReferenceLedgerRepository(
  storage: StoragePort,
): ReferenceLedgerRepository {
  const listItems = async (projectId: string): Promise<ReferenceItem[]> => {
    const rows = await storage.query('referenceItems', { projectId })
    return rows
      .map((row) => itemOf(row as unknown as Record<string, unknown>))
      .filter((item): item is ReferenceItem => item !== null)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  }
  const listUsages = async (
    projectId: string,
    taskKey?: string,
  ): Promise<ReferenceUsage[]> => {
    const filter = taskKey ? { projectId, taskKey } : { projectId }
    const rows = await storage.query('referenceUsages', filter)
    return rows
      .map((row) => usageOf(row as unknown as Record<string, unknown>))
      .filter((usage): usage is ReferenceUsage => usage !== null)
  }
  return {
    listItems,
    listUsages,
    async putItem(item) {
      await storage.put('referenceItems', item as never)
    },
    async putUsage(usage) {
      await storage.put('referenceUsages', usage as never)
    },
    async removeItem(projectId, id) {
      const item = (await listItems(projectId)).find((row) => row.id === id)
      if (!item) return
      const usages = await listUsages(projectId)
      await storage.transaction(['referenceItems', 'referenceUsages'], async (tx) => {
        await tx.delete('referenceItems', id)
        for (const usage of usages.filter((row) => row.itemId === id)) {
          await tx.delete('referenceUsages', usage.id)
        }
      })
    },
    async selectForTask(projectId, taskKey) {
      const [items, usages] = await Promise.all([
        listItems(projectId),
        listUsages(projectId, taskKey),
      ])
      return selectReferencesForTask({ items, usages, projectId, taskKey })
    },
  }
}
