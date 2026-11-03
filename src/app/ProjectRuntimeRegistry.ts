import type { TaskShutdownControl } from '../features/shared/lifecycle/taskLifecycle'

interface ProjectRuntimeRegistration {
  key: string
  projectId: string
  generation: number
  active: boolean
  beginDispose: () => TaskShutdownControl
}

export interface ProjectRuntimeRegistrationHandle {
  key: string
  projectId: string
  generation: number
}

interface PreparedRuntime {
  runtime: ProjectRuntimeRegistration
  control: TaskShutdownControl
  settled: boolean
}

export interface ProjectRuntimeDisposal {
  /** 数据库操作失败时恢复仍保留的全部 runtime / host。 */
  rollback(): boolean
  /** 数据库成功后提交清理；调用前不能 purge / 移出 UI。 */
  commit(): Promise<boolean>
}

const registrations = new Map<
  string,
  Map<string, ProjectRuntimeRegistration>
>()
const projectOperations = new Map<string, ProjectOperation>()
let nextGeneration = 1

interface ProjectOperation {
  readonly projectIds: ReadonlySet<string>
  readonly prepared: PreparedRuntime[]
  released: boolean
}

export class ProjectRuntimeBusyError extends Error {
  readonly projectIds: readonly string[]

  constructor(projectIds: readonly string[]) {
    super('项目运行态正在收尾，稍后重试')
    this.name = 'ProjectRuntimeBusyError'
    this.projectIds = [...new Set(projectIds)]
  }
}

function claimProjects(
  projectIds: readonly string[],
): ProjectOperation {
  const ids = [...new Set(projectIds)]
  const busy = ids.filter((projectId) =>
    projectOperations.has(projectId),
  )
  if (busy.length > 0) {
    throw new ProjectRuntimeBusyError(busy)
  }
  const operation: ProjectOperation = {
    projectIds: new Set(ids),
    prepared: [],
    released: false,
  }
  for (const projectId of ids) {
    projectOperations.set(projectId, operation)
  }
  return operation
}

function releaseProjectOperation(
  operation: ProjectOperation,
): void {
  if (operation.released) return
  operation.released = true
  for (const projectId of operation.projectIds) {
    if (projectOperations.get(projectId) === operation) {
      projectOperations.delete(projectId)
    }
  }
}

function controlsOf(
  prepared: readonly PreparedRuntime[],
): TaskShutdownControl[] {
  return prepared.map((item) => item.control)
}

function preparedRuntimeOf(
  operation: ProjectOperation,
  runtime: ProjectRuntimeRegistration,
): PreparedRuntime | undefined {
  return operation.prepared.find((item) => item.runtime === runtime)
}

function beginPreparedRuntime(
  operation: ProjectOperation,
  project: Map<string, ProjectRuntimeRegistration>,
  key: string,
  runtime: ProjectRuntimeRegistration,
): PreparedRuntime {
  const existing = preparedRuntimeOf(operation, runtime)
  if (existing) return existing
  runtime.active = false
  let control: TaskShutdownControl
  try {
    control = runtime.beginDispose()
  } catch (error) {
    runtime.active = true
    if (project.get(key) === runtime) project.delete(key)
    throw error
  }
  const item: PreparedRuntime = {
    runtime,
    control,
    settled: false,
  }
  operation.prepared.push(item)
  return item
}

function collectLateRuntimes(
  operation: ProjectOperation,
): boolean {
  let added = false
  for (const projectId of operation.projectIds) {
    const project = registrations.get(projectId)
    if (!project) continue
    for (const [key, runtime] of project) {
      if (preparedRuntimeOf(operation, runtime)) continue
      beginPreparedRuntime(operation, project, key, runtime)
      added = true
    }
  }
  return added
}

async function waitForPreparedIdle(
  operation: ProjectOperation,
): Promise<void> {
  let cursor = 0
  while (cursor < operation.prepared.length) {
    const batch = operation.prepared.slice(cursor)
    cursor = operation.prepared.length
    await Promise.all(
      batch.map((item) => item.control.waitForIdle()),
    )
    batch.forEach((item) => {
      item.settled = true
    })
    collectLateRuntimes(operation)
  }
}

async function settlePrepared(
  operation: ProjectOperation,
): Promise<void> {
  let cursor = 0
  while (cursor < operation.prepared.length) {
    const batch = operation.prepared.slice(cursor)
    cursor = operation.prepared.length
    await Promise.allSettled(
      batch
        .filter((item) => !item.settled)
        .map((item) => item.control.whenIdle()),
    )
    batch.forEach((item) => {
      item.settled = true
    })
    collectLateRuntimes(operation)
  }
}

function recoverPrepared(operation: ProjectOperation): boolean {
  collectLateRuntimes(operation)
  const controls = controlsOf(operation.prepared)
  if (controls.every((control) => control.canReopen())) {
    const reopened = controls.every((control) => control.reopenIfIdle())
    if (reopened) {
      for (const item of operation.prepared) item.runtime.active = true
      releaseProjectOperation(operation)
    }
    return reopened
  }
  void settlePrepared(operation).then(() => {
    let current = controlsOf(operation.prepared)
    while (collectLateRuntimes(operation)) {
      current = controlsOf(operation.prepared)
    }
    if (current.every((control) => control.canReopen())) {
      current.forEach((control) => control.reopenIfIdle())
      operation.prepared.forEach((item) => {
        item.runtime.active = true
      })
      releaseProjectOperation(operation)
    }
  })
  return false
}

/**
 * 每项目运行时清理入口。
 *
 * 注册本身不随 React effect cleanup 撤销：StrictMode 的模拟卸载只能
 * deactivate host，不能提前 dispose。真正删除 / HMR 由显式调用触发。
 */
export function registerProjectRuntime(
  input: Omit<ProjectRuntimeRegistration, 'generation' | 'active'>,
): ProjectRuntimeRegistrationHandle {
  const operation = projectOperations.get(input.projectId)
  if (operation) {
    const current = registrations.get(input.projectId)?.get(input.key)
    if (current) {
      return {
        key: current.key,
        projectId: current.projectId,
        generation: current.generation,
      }
    }
  }
  const registration: ProjectRuntimeRegistration = {
    ...input,
    generation: nextGeneration++,
    active: !operation,
  }
  let project = registrations.get(input.projectId)
  if (!project) {
    project = new Map()
    registrations.set(input.projectId, project)
  }
  project.set(input.key, registration)
  if (operation) {
    beginPreparedRuntime(
      operation,
      project,
      input.key,
      registration,
    )
  }
  return {
    key: registration.key,
    projectId: registration.projectId,
    generation: registration.generation,
  }
}

/**
 * 两阶段关闭：先同步阻断新工作并等待 idle，数据库成功后才 commit。
 *
 * 失败时立即恢复 idle participant；仍有在途 Promise 的 participant 会在
 * 真正 idle 后恢复，绝不在未 idle 时假装重开，也不提前 purge。
 */
export async function prepareProjectRuntimes(
  projectIds: readonly string[],
): Promise<ProjectRuntimeDisposal> {
  const operation = claimProjects(projectIds)
  let committed = false
  try {
    for (const projectId of operation.projectIds) {
      const project = registrations.get(projectId)
      if (!project) continue
      for (const [key, runtime] of [...project.entries()]) {
        beginPreparedRuntime(
          operation,
          project,
          key,
          runtime,
        )
      }
    }
  } catch (error) {
    recoverPrepared(operation)
    throw error
  }

  const disposal: ProjectRuntimeDisposal = {
    rollback() {
      if (committed) return false
      return recoverPrepared(operation)
    },
    async commit() {
      if (committed) return false
      let finalized = true
      try {
        while (true) {
          collectLateRuntimes(operation)
          await settlePrepared(operation)
          if (!collectLateRuntimes(operation)) break
        }
        const controls = controlsOf(operation.prepared)
        for (const control of controls) {
          try {
            if (!control.canFinalize() || !control.finalize()) {
              finalized = false
            }
          } catch {
            finalized = false
          }
        }
      } catch {
        finalized = false
      }
      committed = true
      for (const projectId of operation.projectIds) {
        registrations.delete(projectId)
      }
      releaseProjectOperation(operation)
      return finalized
    },
  }

  try {
    await waitForPreparedIdle(operation)
  } catch (error) {
    recoverPrepared(operation)
    throw error
  }
  return disposal
}

export async function withPreparedProjectRuntimes<T>(
  projectIds: readonly string[],
  work: () => Promise<T>,
): Promise<T> {
  const disposal = await prepareProjectRuntimes(projectIds)
  try {
    const result = await work()
    const committed = await disposal.commit()
    if (!committed) {
      console.error('[project-runtime] 数据库写入成功，但运行时清理未能提交')
    }
    return result
  } catch (error) {
    disposal.rollback()
    throw error
  }
}

export async function disposeProjectRuntimes(
  projectIds: readonly string[],
): Promise<void> {
  const disposal = await prepareProjectRuntimes(projectIds)
  if (!(await disposal.commit())) {
    throw new Error('项目运行时未能安全完成清理')
  }
}

export async function disposeAllProjectRuntimes(): Promise<void> {
  await disposeProjectRuntimes([...registrations.keys()])
}

export function resetProjectRuntimesForTests(): void {
  registrations.clear()
  projectOperations.clear()
  nextGeneration = 1
}
