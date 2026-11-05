import type { NoticeTone } from '../../domain/ui/notice'
import {
  ProjectRuntimeCleanupError,
  retryProjectRuntimeCleanup,
  withPreparedProjectRuntimes,
} from '../../app/ProjectRuntimeRegistry'

export interface ProjectDeletionNotice {
  text: string
  tone: NoticeTone
}

export interface DeleteProjectPorts {
  status(notice: ProjectDeletionNotice): void
  setCleanupOperationId(id: number | null): void
}

export interface RetryCleanupPorts extends DeleteProjectPorts {
  busy(): boolean
  setBusy(value: boolean): void
  load(): Promise<void>
  refreshTrash(): Promise<void>
  trashOpen(): boolean
}

export function reportDeleteFailure(
  ports: DeleteProjectPorts,
  error: unknown,
  prefix: string,
): void {
  if (error instanceof ProjectRuntimeCleanupError) {
    ports.setCleanupOperationId(error.operationId ?? null)
    ports.status({ text: error.message, tone: 'error' })
    return
  }
  ports.status({
    text: `${prefix}：${error instanceof Error ? error.message : String(error)}`,
    tone: 'error',
  })
}

export async function deleteProjectsWithRuntime<T>(
  projectIds: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  let result!: T
  await withPreparedProjectRuntimes(projectIds, async () => {
    result = await work()
  })
  return result
}

export async function retryProjectCleanup(
  ports: RetryCleanupPorts,
  cleanupPending: { projectIds: readonly string[] } | null,
  cleanupCommitting: boolean,
): Promise<void> {
  if (!cleanupPending || ports.busy() || cleanupCommitting) return
  ports.setBusy(true)
  try {
    const projectIds = cleanupPending.projectIds
    await retryProjectRuntimeCleanup(projectIds)
    await ports.load()
    if (ports.trashOpen()) await ports.refreshTrash()
    ports.setCleanupOperationId(null)
    ports.status({ text: '项目运行态清理完成', tone: 'info' })
  } catch (error) {
    reportDeleteFailure(ports, error, '运行态清理失败')
  } finally {
    ports.setBusy(false)
  }
}
