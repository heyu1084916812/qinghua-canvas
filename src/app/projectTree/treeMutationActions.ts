import { WORKBENCH_ORDER, type WorkbenchId } from '../../domain/shared/workbench'
import type { ProjectRepository } from '../../state/project/repository'
import {
  ProjectRuntimeCleanupError,
  retryProjectRuntimeCleanup,
  withPreparedProjectRuntimes,
} from '../ProjectRuntimeRegistry'

export type ProjectTreeStatusTone = 'info' | 'error'

export interface ProjectTreeStatus {
  text: string
  tone: ProjectTreeStatusTone
}

export interface ProjectTreeConfirmTarget {
  kind: 'folder' | 'project'
  id: string
  name: string
}

export interface ProjectTreeMutationPorts {
  repo: Pick<
    ProjectRepository,
    | 'create'
    | 'createFolder'
    | 'rename'
    | 'renameFolder'
    | 'remove'
    | 'removeFolder'
    | 'setProjectFolder'
  >
  projects: readonly { id: string; folderId?: string | null }[]
  navigate(route: string): void
  projectRoute(workbench: WorkbenchId, id: string): string
  status(status: ProjectTreeStatus): void
  clearMenu(): void
  setRenameTarget(target: { kind: 'folder' | 'project'; id: string; value: string } | null): void
  setConfirmTarget(target: ProjectTreeConfirmTarget | null): void
  setCleanupOperationId(id: number | null): void
  busy(): boolean
  setBusy(value: boolean): void
  load(): Promise<void>
}

const SHORT_WORKBENCH_LABEL: Record<WorkbenchId, string> = {
  canvas: '画布',
  ecommerce: '电商',
  storyboard: '漫剧',
}

function failure(prefix: string, error: unknown): ProjectTreeStatus {
  return {
    text: `${prefix}：${error instanceof Error ? error.message : String(error)}`,
    tone: 'error',
  }
}

/**
 * Owns the tree's repository mutations and their status order.
 * Runtime locks and cleanup retries remain calls through ProjectRuntimeRegistry.
 */
export function createProjectTreeMutationActions(ports: ProjectTreeMutationPorts) {
  const {
    repo,
    projects,
    navigate,
    projectRoute,
    status,
    clearMenu,
    setRenameTarget,
    setConfirmTarget,
    setCleanupOperationId,
    busy,
    setBusy,
    load,
  } = ports

  const createFolder = async () => {
    clearMenu()
    try {
      const folder = await repo.createFolder()
      setRenameTarget({ kind: 'folder', id: folder.id, value: folder.name })
    } catch (error) {
      status(failure('新建文件夹失败', error))
    }
  }

  const createProject = async (workbench: WorkbenchId, folderId?: string) => {
    clearMenu()
    try {
      const item = await repo.create({ workbench, folderId: folderId ?? null })
      navigate(projectRoute(item.workbench, item.id))
    } catch (error) {
      status(failure(`新建${SHORT_WORKBENCH_LABEL[workbench]}失败`, error))
    }
  }

  const submitRename = async (target: {
    kind: 'folder' | 'project'
    id: string
    value: string
  } | null) => {
    const next = target?.value.trim()
    if (!target || !next) return
    try {
      if (target.kind === 'folder') await repo.renameFolder(target.id, next)
      else await repo.rename(target.id, next)
      setRenameTarget(null)
    } catch (error) {
      status(failure('重命名失败', error))
    }
  }

  const moveProject = async (projectId: string, folderId: string | null) => {
    clearMenu()
    try {
      await repo.setProjectFolder(projectId, folderId)
    } catch (error) {
      status(failure('移动项目失败', error))
    }
  }

  const moveAllOut = async (folderId: string) => {
    clearMenu()
    const inside = projects.filter((project) => project.folderId === folderId)
    try {
      for (const project of inside) await repo.setProjectFolder(project.id, null)
      status({
        text: inside.length
          ? `已把 ${inside.length} 个项目移到未归档`
          : '这个文件夹里没有项目',
        tone: 'info',
      })
    } catch (error) {
      status(failure('移出文件夹失败', error))
    }
  }

  const askDelete = (target: ProjectTreeConfirmTarget) => {
    clearMenu()
    setConfirmTarget(target)
  }

  const confirmDelete = async (target: ProjectTreeConfirmTarget | null) => {
    if (!target || busy()) return
    setBusy(true)
    try {
      if (target.kind === 'folder') await repo.removeFolder(target.id)
      else {
        await withPreparedProjectRuntimes([target.id], () => repo.remove(target.id))
      }
      status({
        text:
          target.kind === 'folder'
            ? '文件夹已删除，里面的项目已移到未归档'
            : '项目已移到回收站',
        tone: 'info',
      })
      setCleanupOperationId(null)
      setConfirmTarget(null)
    } catch (error) {
      if (error instanceof ProjectRuntimeCleanupError) {
        setCleanupOperationId(error.operationId ?? null)
        setConfirmTarget(null)
        clearMenu()
        status({ text: error.message, tone: 'error' })
        return
      }
      status(failure('删除失败', error))
    } finally {
      setBusy(false)
    }
  }

  const retryRuntimeCleanup = async (projectIds: readonly string[]) => {
    if (busy()) return
    setBusy(true)
    try {
      await retryProjectRuntimeCleanup(projectIds)
      await load()
      setCleanupOperationId(null)
      status({ text: '项目运行态清理完成', tone: 'info' })
    } catch (error) {
      if (error instanceof ProjectRuntimeCleanupError) {
        setCleanupOperationId(error.operationId ?? null)
        status({ text: error.message, tone: 'error' })
      } else {
        status({
          text: `运行态清理失败：${error instanceof Error ? error.message : String(error)}`,
          tone: 'error',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return {
    WORKBENCH_ORDER,
    createFolder,
    createProject,
    submitRename,
    moveProject,
    moveAllOut,
    askDelete,
    confirmDelete,
    retryRuntimeCleanup,
  }
}
