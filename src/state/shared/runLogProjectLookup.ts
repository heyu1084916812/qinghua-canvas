import type { Project } from '../../domain/project/project'
import type { RunRecord } from '../../domain/shared/execution/runRecord'
import type { StoragePort } from '../../platform/ports'

export interface RunLogProjectLookup {
  prepare(records: readonly RunRecord[]): Promise<void>
  get(projectId: string): Project | null
}

/**
 * Batch project classification for one log candidate page.
 *
 * Legacy log records need their owning project to infer a workbench. Loading
 * one project per record becomes an N+1 of `/query` calls on JSON V1 stores,
 * so the reader resolves all ids in the current page once.
 */
export function createRunLogProjectLookup(storage: StoragePort): RunLogProjectLookup {
  const projects = new Map<string, Project | null>()
  const queryPage = storage.queryPage?.bind(storage)

  return {
    async prepare(records) {
      const missing = [...new Set(records.map((record) => record.projectId))]
        .filter((id) => !!id && !projects.has(id))
      if (missing.length === 0) return

      if (queryPage) {
        const found = new Map<string, Project>()
        const limit = 100
        for (let offset = 0; offset < missing.length; offset += limit) {
          const ids = missing.slice(offset, offset + limit)
          const page = await queryPage('projects', {}, {
            ids,
            includePayload: false,
            limit: ids.length,
          })
          for (const row of page.rows) {
            found.set(String(row.id), row as unknown as Project)
          }
        }
        for (const id of missing) projects.set(id, found.get(id) ?? null)
        return
      }

      const rows = (await storage.query('projects', {})) as unknown as Project[]
      const wanted = new Set(missing)
      const found = new Map(
        rows
          .filter((row) => wanted.has(row.id))
          .map((row) => [row.id, row] as const),
      )
      for (const id of missing) projects.set(id, found.get(id) ?? null)
    },
    get(projectId) {
      return projects.get(projectId) ?? null
    },
  }
}
