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
  released: boolean
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

export type ProjectRuntimeRollbackResult =
  | { status: 'rolled_back' }
  | {
      status: 'recovery_pending'
      error: ProjectRuntimeRecoveryError
    }

export interface ProjectRuntimeDisposal {
  /** 数据库操作失败时恢复仍保留的全部 runtime / host。 */
  rollback(cause?: unknown): ProjectRuntimeRollbackResult
  /** 数据库成功后提交清理；调用前不能 purge / 移出 UI。 */
  commit(
    workResult?: unknown,
    options?: ProjectRuntimeCommitOptions,
  ): Promise<ProjectRuntimeCommitResult>
}

export interface ProjectRuntimeCommitOptions {
  /**
   * 普通删除为 true；HMR 等只关闭 runtime 的路径为 false。
   * 一旦开始提交，后续重试沿用首次选择的语义。
   */
  markWorkCommitted?: boolean
}

export interface ProjectRuntimeCompletion {
  operationId: number
  projectIds: readonly string[]
  workCommitted: boolean
}

const registrations = new Map<
  string,
  Map<string, ProjectRuntimeRegistration>
>()
const projectOperations = new Map<string, ProjectOperation>()
let nextGeneration = 1
let nextOperationId = 1
const pendingListeners = new Set<() => void>()
const completionListeners = new Set<
  (completion: ProjectRuntimeCompletion) => void
>()
let pendingSnapshot: readonly ProjectRuntimePendingOperation[] = []

export type ProjectRuntimeOperationPhase =
  | 'preparing'
  | 'prepared'
  | 'committing'
  | 'recovering'
  | 'recovery_failed'
  | 'cleanup_failed'
  | 'cleanup_complete'

interface ProjectOperation {
  readonly id: number
  readonly projectIds: ReadonlySet<string>
  readonly prepared: PreparedRuntime[]
  readonly shutdownTimeoutMs: number
  phase: ProjectRuntimeOperationPhase
  commitPromise: Promise<ProjectRuntimeCommitResult> | null
  commitMarksWork: boolean | null
  recoveryPromise: Promise<boolean> | null
  recoveryError: ProjectRuntimeRecoveryError | null
  triggerReason: string | null
  workReason: string | null
  recoveryReason: string | null
  workCommitted: boolean
  workResult: unknown
  released: boolean
}

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

export class ProjectRuntimeBusyError extends Error {
  readonly projectIds: readonly string[]

  constructor(projectIds: readonly string[]) {
    super('项目运行态正在收尾，稍后重试')
    this.name = 'ProjectRuntimeBusyError'
    this.projectIds = [...new Set(projectIds)]
  }
}

export class ProjectRuntimeCleanupError extends Error {
  readonly operationId?: number
  readonly projectIds: readonly string[]
  readonly reason: string
  readonly workCommitted = true
  readonly retryable = true

  constructor(
    projectIds: readonly string[],
    error: unknown,
    operationId?: number,
  ) {
    const reason =
      error instanceof Error ? error.message : String(error)
    super(
      `项目数据已删除，但运行态清理失败，可重试清理：${reason}`,
    )
    this.name = 'ProjectRuntimeCleanupError'
    this.operationId = operationId
    this.projectIds = [...new Set(projectIds)]
    this.reason = reason
  }
}

export class ProjectRuntimeCommitStateError extends Error {
  readonly operationId: number
  readonly projectIds: readonly string[]
  readonly phase: ProjectRuntimeOperationPhase
  readonly workCommitted = false

  constructor(operation: ProjectOperation) {
    super(
      `项目运行态当前处于 ${operation.phase}，不能进入清理提交`,
    )
    this.name = 'ProjectRuntimeCommitStateError'
    this.operationId = operation.id
    this.projectIds = [...operation.projectIds]
    this.phase = operation.phase
  }
}

export class ProjectRuntimeRecoveryError extends Error {
  readonly operationId: number
  readonly projectIds: readonly string[]
  readonly workCommitted = false
  readonly retryable = true
  readonly triggerReason: string
  readonly workReason: string | null
  readonly recoveryReason: string

  constructor(
    operationId: number,
    projectIds: readonly string[],
    {
      triggerReason,
      workReason,
      recoveryReason,
    }: {
      triggerReason: string
      workReason: string | null
      recoveryReason: string
    },
  ) {
    const operationReason =
      workReason ?? triggerReason
    super(
      `项目操作未提交，但运行态恢复未完成，可重试恢复。原操作：${operationReason}；恢复：${recoveryReason}`,
    )
    this.name = 'ProjectRuntimeRecoveryError'
    this.operationId = operationId
    this.projectIds = [...new Set(projectIds)]
    this.triggerReason = triggerReason
    this.workReason = workReason
    this.recoveryReason = recoveryReason
  }
}

export class ProjectRuntimeRetryScopeError extends Error {
  readonly projectIds: readonly string[]
  readonly pendingProjectIds: readonly string[]

  constructor(
    projectIds: readonly string[],
    pendingProjectIds: readonly string[],
  ) {
    super('重试集合与待处理项目不一致，未执行任何清理')
    this.name = 'ProjectRuntimeRetryScopeError'
    this.projectIds = [...new Set(projectIds)]
    this.pendingProjectIds = [...new Set(pendingProjectIds)]
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

function uniqueOperations(): ProjectOperation[] {
  return [...new Set(projectOperations.values())]
}

function pendingOperationSnapshot(
  operation: ProjectOperation,
): ProjectRuntimePendingOperation | null {
  let status: ProjectRuntimePendingStatus
  if (operation.phase === 'committing') {
    status = 'committing'
  } else if (operation.phase === 'cleanup_failed') {
    status = 'cleanup_failed'
  } else if (operation.phase === 'recovering') {
    status = 'recovering'
  } else if (operation.phase === 'recovery_failed') {
    status = 'recovery_failed'
  } else {
    return null
  }
  const reason =
    status === 'committing'
      ? '正在清理项目运行态'
      : status === 'cleanup_failed'
      ? operation.triggerReason ?? '运行态清理失败'
      : [
          operation.workReason
            ? `原操作：${operation.workReason}`
            : null,
          operation.recoveryReason
            ? `恢复：${operation.recoveryReason}`
            : '恢复：等待运行态恢复',
        ]
          .filter(Boolean)
          .join('；')
  return {
    id: operation.id,
    projectIds: [...operation.projectIds],
    status,
    workCommitted: operation.workCommitted,
    retryable:
      status === 'cleanup_failed' ||
      status === 'recovery_failed',
    reason,
    workReason: operation.workReason,
    recoveryReason: operation.recoveryReason,
  }
}

function refreshPendingSnapshot(): void {
  const next = uniqueOperations()
    .map(pendingOperationSnapshot)
    .filter(
      (item): item is ProjectRuntimePendingOperation => !!item,
    )
    .sort((left, right) => left.id - right.id)
  const unchanged =
    next.length === pendingSnapshot.length &&
    next.every((item, index) => {
      const current = pendingSnapshot[index]
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
  if (unchanged) return
  pendingSnapshot = next
  pendingListeners.forEach((listener) => listener())
}

export function subscribeProjectRuntimePending(
  listener: () => void,
): () => void {
  pendingListeners.add(listener)
  return () => pendingListeners.delete(listener)
}

export function getProjectRuntimePendingSnapshot():
  readonly ProjectRuntimePendingOperation[] {
  return pendingSnapshot
}

export function subscribeProjectRuntimeCompleted(
  listener: (completion: ProjectRuntimeCompletion) => void,
): () => void {
  completionListeners.add(listener)
  return () => {
    completionListeners.delete(listener)
  }
}

function emitProjectRuntimeCompleted(
  operation: ProjectOperation,
): void {
  if (!operation.workCommitted) return
  const completion: ProjectRuntimeCompletion = {
    operationId: operation.id,
    projectIds: [...operation.projectIds],
    workCommitted: true,
  }
  for (const listener of [...completionListeners]) {
    try {
      listener(completion)
    } catch {
      // 运行态已经清理成功；订阅方的界面收尾异常不能反转提交结果。
    }
  }
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
    id: nextOperationId++,
    projectIds: new Set(ids),
    prepared: [],
    shutdownTimeoutMs:
      options.shutdownTimeoutMs ??
      DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
    phase: 'preparing',
    commitPromise: null,
    commitMarksWork: null,
    recoveryPromise: null,
    recoveryError: null,
    triggerReason: null,
    workReason: null,
    recoveryReason: null,
    workCommitted: false,
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
  refreshPendingSnapshot()
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
    released: false,
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
        .filter((item) => !item.idle && !item.finalized)
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
        .filter((item) => !item.idle && !item.finalized)
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

function tryReopenPrepared(operation: ProjectOperation): boolean {
  if (operation.prepared.some((item) => item.finalized)) {
    return false
  }
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
  operation.recoveryReason = null
  operation.recoveryPromise = null
  releaseProjectOperation(operation)
  return true
}

function recoveryErrorFor(
  operation: ProjectOperation,
): ProjectRuntimeRecoveryError {
  const triggerReason =
    operation.triggerReason ?? '运行态关闭未完成'
  const recoveryReason =
    operation.recoveryReason ?? '等待运行态达到可恢复状态'
  const error = new ProjectRuntimeRecoveryError(
    operation.id,
    [...operation.projectIds],
    {
      triggerReason,
      workReason: operation.workReason,
      recoveryReason,
    },
  )
  operation.recoveryError = error
  return error
}

async function runRecovery(
  operation: ProjectOperation,
): Promise<boolean> {
  try {
    await settlePrepared(operation)
    if (!tryReopenPrepared(operation)) {
      throw new Error('运行态仍未达到可恢复状态')
    }
    operation.recoveryError = null
    operation.recoveryReason = null
    return true
  } catch (error) {
    if (tryReopenPrepared(operation)) {
      return true
    }
    operation.phase = 'recovery_failed'
    operation.recoveryReason = errorText(error)
    recoveryErrorFor(operation)
    refreshPendingSnapshot()
    return false
  } finally {
    operation.recoveryPromise = null
  }
}

function beginRecovery(
  operation: ProjectOperation,
  cause: unknown,
  fromWork: boolean,
): ProjectRuntimeRollbackResult {
  operation.triggerReason = errorText(cause)
  if (fromWork) operation.workReason = errorText(cause)
  if (tryReopenPrepared(operation)) {
    return { status: 'rolled_back' }
  }
  if (!operation.recoveryPromise) {
    operation.phase = 'recovering'
    operation.recoveryReason = '等待运行态达到可恢复状态'
    refreshPendingSnapshot()
    operation.recoveryPromise = runRecovery(operation)
  }
  return {
    status: 'recovery_pending',
    error: recoveryErrorFor(operation),
  }
}

async function retryOperationRecovery(
  operation: ProjectOperation,
): Promise<boolean> {
  if (tryReopenPrepared(operation)) return true
  if (operation.recoveryPromise) {
    return operation.recoveryPromise
  }
  operation.phase = 'recovering'
  operation.recoveryReason = '正在重试运行态恢复'
  refreshPendingSnapshot()
  operation.recoveryPromise = runRecovery(operation)
  return operation.recoveryPromise
}

function operationForExactIds(
  projectIds: readonly string[],
): ProjectOperation | null {
  const ids = [...new Set(projectIds)]
  let operation: ProjectOperation | null = null
  for (const projectId of ids) {
    const current = projectOperations.get(projectId)
    if (!current) return null
    if (operation && operation !== current) return null
    operation = current
  }
  if (!operation || operation.projectIds.size !== ids.length) {
    return null
  }
  return operation
}

function relatedOperations(
  projectIds: readonly string[],
): ProjectOperation[] {
  const ids = new Set(projectIds)
  return uniqueOperations().filter(
    (operation) =>
      pendingOperationSnapshot(operation) !== null &&
      [...operation.projectIds].some((projectId) =>
        ids.has(projectId),
      ),
  )
}

async function performCommitOperation(
  operation: ProjectOperation,
): Promise<ProjectRuntimeCommitResult> {
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
    for (const item of operation.prepared) {
      if (item.released) continue
      item.control.releaseFinalized?.()
      item.released = true
    }
  } catch (error) {
    operation.phase = 'cleanup_failed'
    operation.triggerReason = errorText(error)
    operation.recoveryReason = null
    refreshPendingSnapshot()
    return {
      status: 'cleanup_failed',
      error: new ProjectRuntimeCleanupError(
        [...operation.projectIds],
        error,
        operation.id,
      ),
    }
  } finally {
    operation.commitPromise = null
  }

  operation.phase = 'cleanup_complete'
  for (const projectId of operation.projectIds) {
    const project = registrations.get(projectId)
    if (!project) continue
    for (const item of operation.prepared) {
      if (
        item.runtime.projectId === projectId &&
        project.get(item.runtime.key) === item.runtime
      ) {
        project.delete(item.runtime.key)
      }
    }
    if (project.size === 0) registrations.delete(projectId)
  }
  releaseProjectOperation(operation)
  emitProjectRuntimeCompleted(operation)
  return { status: 'cleanup_complete' }
}

function commitOperation(
  operation: ProjectOperation,
  workResult?: unknown,
  options: ProjectRuntimeCommitOptions = {},
): Promise<ProjectRuntimeCommitResult> {
  if (operation.phase === 'cleanup_complete') {
    return Promise.resolve({ status: 'cleanup_complete' })
  }
  if (operation.phase === 'committing') {
    if (operation.commitPromise) return operation.commitPromise
    return Promise.reject(
      new ProjectRuntimeCommitStateError(operation),
    )
  }
  if (
    operation.phase !== 'prepared' &&
    operation.phase !== 'cleanup_failed'
  ) {
    return Promise.reject(
      new ProjectRuntimeCommitStateError(operation),
    )
  }
  if (operation.commitMarksWork === null) {
    operation.commitMarksWork =
      options.markWorkCommitted ?? true
    operation.workResult = workResult
  }
  operation.workCommitted = operation.commitMarksWork
  operation.phase = 'committing'
  refreshPendingSnapshot()
  const committing = performCommitOperation(operation)
  operation.commitPromise = committing
  return committing
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
    const recovery = beginRecovery(operation, error, false)
    if (recovery.status === 'rolled_back') throw error
    throw recovery.error
  }

  const disposal: ProjectRuntimeDisposal = {
    rollback(cause: unknown = new Error('项目操作已取消')) {
      if (operation.phase === 'cleanup_complete') {
        return { status: 'rolled_back' }
      }
      return beginRecovery(operation, cause, true)
    },
    commit(
      workResult?: unknown,
      commitOptions?: ProjectRuntimeCommitOptions,
    ) {
      return commitOperation(
        operation,
        workResult,
        commitOptions,
      )
    },
  }

  try {
    await waitForPreparedIdle(operation)
  } catch (error) {
    const recovery = beginRecovery(operation, error, false)
    if (recovery.status === 'rolled_back') throw error
    throw recovery.error
  }
  operation.phase = 'prepared'
  return disposal
}

export async function withPreparedProjectRuntimes<T>(
  projectIds: readonly string[],
  work: () => Promise<T>,
  options: ProjectRuntimePrepareOptions = {},
): Promise<T> {
  const pending = operationForExactIds(projectIds)
  if (pending?.phase === 'cleanup_failed') {
    const retried = await commitOperation(pending)
    if (retried.status === 'cleanup_failed') throw retried.error
    return pending.workResult as T
  }
  if (
    pending?.phase === 'recovering' ||
    pending?.phase === 'recovery_failed'
  ) {
    const recovered = await retryOperationRecovery(pending)
    if (!recovered) {
      throw pending.recoveryError ?? recoveryErrorFor(pending)
    }
  }

  const disposal = await prepareProjectRuntimes(projectIds, options)
  let result: T
  try {
    result = await work()
  } catch (error) {
    const recovery = disposal.rollback(error)
    if (recovery.status === 'recovery_pending') {
      throw recovery.error
    }
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
  const pending = operationForExactIds(projectIds)
  if (pending?.phase === 'cleanup_failed') {
    const retried = await commitOperation(pending)
    if (retried.status === 'cleanup_failed') throw retried.error
    return
  }
  if (
    pending?.phase === 'recovering' ||
    pending?.phase === 'recovery_failed'
  ) {
    const recovered = await retryOperationRecovery(pending)
    if (!recovered) {
      throw pending.recoveryError ?? recoveryErrorFor(pending)
    }
  }
  const disposal = await prepareProjectRuntimes(projectIds, options)
  const committed = await disposal.commit(undefined, {
    markWorkCommitted: false,
  })
  if (committed.status === 'cleanup_failed') {
    throw committed.error
  }
}

export async function retryProjectRuntimeCleanup(
  projectIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(projectIds)]
  const related = relatedOperations(ids)
  if (related.length === 0) return
  const pending = related[0]
  const exact =
    related.length === 1 &&
    !!pending &&
    pending.phase === 'cleanup_failed' &&
    pending.projectIds.size === ids.length &&
    ids.every((projectId) => pending.projectIds.has(projectId))
  if (!exact) {
    throw new ProjectRuntimeRetryScopeError(
      ids,
      related.flatMap((operation) => [...operation.projectIds]),
    )
  }
  const result = await commitOperation(pending)
  if (result.status === 'cleanup_failed') {
    throw result.error
  }
}

export async function retryProjectRuntimeOperation(
  operationId: number,
): Promise<void> {
  const operation = uniqueOperations().find(
    (item) => item.id === operationId,
  )
  if (!operation) return
  if (operation.phase === 'cleanup_failed') {
    const result = await commitOperation(operation)
    if (result.status === 'cleanup_failed') throw result.error
    return
  }
  if (
    operation.phase === 'recovering' ||
    operation.phase === 'recovery_failed'
  ) {
    const recovered = await retryOperationRecovery(operation)
    if (!recovered) {
      throw operation.recoveryError ?? recoveryErrorFor(operation)
    }
  }
}

export async function disposeAllProjectRuntimes(): Promise<void> {
  await disposeProjectRuntimes([...registrations.keys()])
}

export function resetProjectRuntimesForTests(): void {
  registrations.clear()
  projectOperations.clear()
  nextGeneration = 1
  nextOperationId = 1
  pendingSnapshot = []
  pendingListeners.forEach((listener) => listener())
}
