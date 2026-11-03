import {
  DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
  TaskLifecycleTimeoutError,
  type TaskShutdownControl,
} from '../features/shared/lifecycle/taskLifecycle'

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
  idle: boolean
  finalized: boolean
  lastError: string | null
}

export interface ProjectRuntimePrepareOptions {
  shutdownTimeoutMs?: number
}

export type ProjectRuntimeCommitResult =
  | { status: 'cleanup_complete' }
  | {
      status: 'cleanup_failed'
      error: ProjectRuntimeCleanupError
    }

export interface ProjectRuntimeDisposal {
  /** 数据库操作失败时恢复仍保留的全部 runtime / host。 */
  rollback(): boolean
  /** 数据库成功后提交清理；调用前不能 purge / 移出 UI。 */
  commit(workResult?: unknown): Promise<ProjectRuntimeCommitResult>
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
  readonly shutdownTimeoutMs: number
  phase: 'preparing' | 'prepared' | 'committing' | 'cleanup_failed' | 'cleanup_complete'
  recoveryError: ProjectRuntimeCleanupError | null
  workResult: unknown
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

export class ProjectRuntimeCleanupError extends Error {
  readonly projectIds: readonly string[]
  readonly reason: string
  readonly workCommitted = true
  readonly retryable = true

  constructor(projectIds: readonly string[], error: unknown) {
    const reason =
      error instanceof Error ? error.message : String(error)
    super(
      `项目数据已删除，但运行态清理失败，可重试清理：${reason}`,
    )
    this.name = 'ProjectRuntimeCleanupError'
    this.projectIds = [...new Set(projectIds)]
    this.reason = reason
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TaskLifecycleTimeoutError(1, timeoutMs))
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

function claimProjects(
  projectIds: readonly string[],
  options: ProjectRuntimePrepareOptions,
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
    shutdownTimeoutMs:
      options.shutdownTimeoutMs ??
      DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
    phase: 'preparing',
    recoveryError: null,
    workResult: undefined,
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
    idle: false,
    finalized: false,
    lastError: null,
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
      batch
        .filter((item) => !item.idle)
        .map(async (item) => {
          try {
            await waitWithTimeout(
              item.control.waitForIdle(),
              operation.shutdownTimeoutMs,
            )
            item.idle = true
            item.lastError = null
          } catch (error) {
            item.idle = false
            item.lastError = errorText(error)
            throw error
          }
        }),
    )
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
    await Promise.all(
      batch
        .filter((item) => !item.idle)
        .map(async (item) => {
          try {
            await waitWithTimeout(
              item.control.whenIdle(),
              operation.shutdownTimeoutMs,
            )
            item.idle = true
            item.lastError = null
          } catch (error) {
            item.idle = false
            item.lastError = errorText(error)
            throw error
          }
        }),
    )
    collectLateRuntimes(operation)
  }
}

function recoverPrepared(operation: ProjectOperation): boolean {
  const reopenAll = (): boolean => {
    while (collectLateRuntimes(operation)) {
      // New registrations join the same recovery before reopening.
    }
    const current = controlsOf(operation.prepared)
    if (!current.every((control) => control.canReopen())) {
      return false
    }
    if (!current.every((control) => control.reopenIfIdle())) {
      return false
    }
    operation.prepared.forEach((item) => {
      item.runtime.active = true
    })
    operation.recoveryError = null
    releaseProjectOperation(operation)
    return true
  }

  collectLateRuntimes(operation)
  const controls = controlsOf(operation.prepared)
  if (controls.every((control) => control.canReopen())) {
    return reopenAll()
  }
  void settlePrepared(operation).then(
    () => {
      reopenAll()
    },
    (error) => {
      operation.recoveryError = new ProjectRuntimeCleanupError(
        [...operation.projectIds],
        error,
      )
      reopenAll()
    },
  )
  return false
}

function pendingCleanupOperation(
  projectIds: readonly string[],
): ProjectOperation | null {
  const ids = [...new Set(projectIds)]
  let operation: ProjectOperation | null = null
  for (const projectId of ids) {
    const current = projectOperations.get(projectId)
    if (!current || current.phase !== 'cleanup_failed') return null
    if (operation && operation !== current) return null
    operation = current
  }
  if (!operation || operation.projectIds.size !== ids.length) {
    return null
  }
  return operation
}

async function commitOperation(
  operation: ProjectOperation,
): Promise<ProjectRuntimeCommitResult> {
  if (operation.phase === 'cleanup_complete') {
    return { status: 'cleanup_complete' }
  }
  operation.phase = 'committing'
  try {
    while (true) {
      collectLateRuntimes(operation)
      await waitForPreparedIdle(operation)
      if (!collectLateRuntimes(operation)) break
    }

    const pending = operation.prepared.filter(
      (item) => !item.finalized,
    )
    for (const item of pending) {
      if (!item.control.canFinalize()) {
        throw new Error(
          `${item.runtime.projectId}/${item.runtime.key} 尚未达到可提交状态`,
        )
      }
    }
    for (const item of pending) {
      let finalized = false
      try {
        finalized = item.control.finalize()
      } catch (error) {
        item.lastError = errorText(error)
        throw error
      }
      if (!finalized) {
        throw new Error(
          `${item.runtime.projectId}/${item.runtime.key} finalize 返回 false`,
        )
      }
      item.finalized = true
      item.idle = false
      item.lastError = null
    }
  } catch (error) {
    operation.phase = 'cleanup_failed'
    return {
      status: 'cleanup_failed',
      error: new ProjectRuntimeCleanupError(
        [...operation.projectIds],
        error,
      ),
    }
  }

  operation.prepared.forEach((item) => {
    item.control.releaseFinalized?.()
  })
  operation.phase = 'cleanup_complete'
  for (const projectId of operation.projectIds) {
    registrations.delete(projectId)
  }
  releaseProjectOperation(operation)
  return { status: 'cleanup_complete' }
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
  options: ProjectRuntimePrepareOptions = {},
): Promise<ProjectRuntimeDisposal> {
  const operation = claimProjects(projectIds, options)
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
      if (operation.phase === 'cleanup_complete') return false
      return recoverPrepared(operation)
    },
    commit(workResult?: unknown) {
      operation.workResult = workResult
      return commitOperation(operation)
    },
  }

  try {
    await waitForPreparedIdle(operation)
  } catch (error) {
    recoverPrepared(operation)
    throw error
  }
  operation.phase = 'prepared'
  return disposal
}

export async function withPreparedProjectRuntimes<T>(
  projectIds: readonly string[],
  work: () => Promise<T>,
  options: ProjectRuntimePrepareOptions = {},
): Promise<T> {
  const pending = pendingCleanupOperation(projectIds)
  if (pending) {
    const retried = await commitOperation(pending)
    if (retried.status === 'cleanup_failed') throw retried.error
    return pending.workResult as T
  }

  const disposal = await prepareProjectRuntimes(projectIds, options)
  let result: T
  try {
    result = await work()
  } catch (error) {
    disposal.rollback()
    throw error
  }
  const committed = await disposal.commit(result)
  if (committed.status === 'cleanup_failed') {
    throw committed.error
  }
  return result
}

export async function disposeProjectRuntimes(
  projectIds: readonly string[],
  options: ProjectRuntimePrepareOptions = {},
): Promise<void> {
  const pending = pendingCleanupOperation(projectIds)
  if (pending) {
    const retried = await commitOperation(pending)
    if (retried.status === 'cleanup_failed') throw retried.error
    return
  }
  const disposal = await prepareProjectRuntimes(projectIds, options)
  const committed = await disposal.commit()
  if (committed.status === 'cleanup_failed') {
    throw committed.error
  }
}

export async function retryProjectRuntimeCleanup(
  projectIds: readonly string[],
): Promise<void> {
  const pending = pendingCleanupOperation(projectIds)
  if (!pending) return
  const result = await commitOperation(pending)
  if (result.status === 'cleanup_failed') {
    throw result.error
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
