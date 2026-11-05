/**
 * Opaque owner token for one atomic project operation claim.
 *
 * The lock stores occupancy only. Registry keeps mutable operation state
 * keyed by `owner`; phases and shutdown state never enter this module.
 */
export interface ProjectOperationLockToken {
  readonly id: number
  readonly projectIds: ReadonlySet<string>
  readonly owner: object
}

export interface ProjectOperationLock {
  claim(
    projectIds: readonly string[],
  ): ProjectOperationLockToken
  get(projectId: string): ProjectOperationLockToken | undefined
  forExactIds(
    projectIds: readonly string[],
  ): ProjectOperationLockToken | null
  owners(): readonly ProjectOperationLockToken[]
  release(token: ProjectOperationLockToken): boolean
  clear(): void
}

export interface ProjectOperationLockOptions {
  onBusy: (busyProjectIds: readonly string[]) => never
}

export function createProjectOperationLock({
  onBusy,
}: ProjectOperationLockOptions): ProjectOperationLock {
  const owners = new Map<
    string,
    ProjectOperationLockToken
  >()
  let nextOperationId = 1

  return {
    claim(projectIds) {
      const ids = new Set(projectIds)
      const busy = [...ids].filter((projectId) =>
        owners.has(projectId),
      )
      if (busy.length > 0) onBusy(busy)

      const id = nextOperationId++
      const token: ProjectOperationLockToken = {
        id,
        projectIds: ids,
        owner: { id },
      }
      for (const projectId of ids) {
        owners.set(projectId, token)
      }
      return token
    },
    get(projectId) {
      return owners.get(projectId)
    },
    forExactIds(projectIds) {
      const ids = new Set(projectIds)
      let token: ProjectOperationLockToken | null = null
      for (const projectId of ids) {
        const current = owners.get(projectId)
        if (!current) return null
        if (token && token !== current) return null
        token = current
      }
      if (!token || token.projectIds.size !== ids.size) return null
      return token
    },
    owners() {
      return [...new Set(owners.values())]
    },
    release(token) {
      let released = false
      for (const projectId of token.projectIds) {
        if (owners.get(projectId) === token) {
          owners.delete(projectId)
          released = true
        }
      }
      return released
    },
    clear() {
      owners.clear()
      nextOperationId = 1
    },
  }
}
