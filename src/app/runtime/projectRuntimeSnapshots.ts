export type ProjectRuntimeOperationPhase =
  | 'preparing'
  | 'prepared'
  | 'committing'
  | 'recovering'
  | 'recovery_failed'
  | 'cleanup_failed'
  | 'cleanup_complete'

export type ProjectRuntimePendingStatus =
  | 'committing'
  | 'recovering'
  | 'recovery_failed'
  | 'cleanup_failed'

export interface ProjectRuntimePendingOperation {
  id: number
  projectIds: readonly string[]
  status: ProjectRuntimePendingStatus
  workCommitted: boolean
  retryable: boolean
  reason: string
  workReason: string | null
  recoveryReason: string | null
}

export interface ProjectRuntimeSnapshotSource {
  readonly id: number
  readonly projectIds: Iterable<string>
  readonly phase: ProjectRuntimeOperationPhase
  readonly workCommitted: boolean
  readonly triggerReason: string | null
  readonly workReason: string | null
  readonly recoveryReason: string | null
}

export interface ProjectRuntimeSnapshotStore {
  refresh(sources: Iterable<ProjectRuntimeSnapshotSource>): void
  getSnapshot(): readonly ProjectRuntimePendingOperation[]
  subscribe(listener: () => void): () => void
  clear(): void
}

function pendingStatusOf(
  phase: ProjectRuntimeOperationPhase,
): ProjectRuntimePendingStatus | null {
  if (phase === 'committing') return 'committing'
  if (phase === 'cleanup_failed') return 'cleanup_failed'
  if (phase === 'recovering') return 'recovering'
  if (phase === 'recovery_failed') return 'recovery_failed'
  return null
}

export function projectRuntimePendingSnapshotOf(
  source: ProjectRuntimeSnapshotSource,
): ProjectRuntimePendingOperation | null {
  const status = pendingStatusOf(source.phase)
  if (!status) return null

  const reason =
    status === 'committing'
      ? '正在清理项目运行态'
      : status === 'cleanup_failed'
        ? source.triggerReason ?? '运行态清理失败'
        : [
            source.workReason
              ? `原操作：${source.workReason}`
              : null,
            source.recoveryReason
              ? `恢复：${source.recoveryReason}`
              : '恢复：等待运行态恢复',
          ]
            .filter(Boolean)
            .join('；')

  return {
    id: source.id,
    projectIds: [...new Set(source.projectIds)],
    status,
    workCommitted: source.workCommitted,
    retryable:
      status === 'cleanup_failed' ||
      status === 'recovery_failed',
    reason,
    workReason: source.workReason,
    recoveryReason: source.recoveryReason,
  }
}

function samePendingSnapshot(
  left: readonly ProjectRuntimePendingOperation[],
  right: readonly ProjectRuntimePendingOperation[],
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const current = right[index]
      return (
        current?.id === item.id &&
        current.status === item.status &&
        current.reason === item.reason &&
        current.workCommitted === item.workCommitted &&
        current.retryable === item.retryable &&
        current.workReason === item.workReason &&
        current.recoveryReason === item.recoveryReason &&
        current.projectIds.length === item.projectIds.length &&
        current.projectIds.every(
          (projectId, projectIndex) =>
            projectId === item.projectIds[projectIndex],
        )
      )
    })
  )
}

/**
 * Publishes a read-only projection. Operation phases and locks remain owned by
 * ProjectRuntimeRegistry.
 */
export function createProjectRuntimeSnapshotStore(): ProjectRuntimeSnapshotStore {
  let snapshot: readonly ProjectRuntimePendingOperation[] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        // Subscribers observe publication and cannot roll it back.
      }
    }
  }

  const store: ProjectRuntimeSnapshotStore = {
    refresh(sources) {
      const byId = new Map<number, ProjectRuntimeSnapshotSource>()
      for (const source of sources) {
        if (!byId.has(source.id)) byId.set(source.id, source)
      }
      const next = [...byId.values()]
        .map(projectRuntimePendingSnapshotOf)
        .filter(
          (
            item,
          ): item is ProjectRuntimePendingOperation => !!item,
        )
        .sort((left, right) => left.id - right.id)
      if (samePendingSnapshot(snapshot, next)) return
      snapshot = next
      notify()
    },
    getSnapshot() {
      return snapshot
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    clear() {
      snapshot = []
      notify()
    },
  }
  return store
}
