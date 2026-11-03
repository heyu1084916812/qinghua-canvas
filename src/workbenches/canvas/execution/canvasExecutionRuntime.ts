import type { ChannelAdapter } from '../../../platform/channels/types'
import {
  createExecutionRuntime,
  type ExecutionRuntime,
} from '../../../features/shared/execution/executionRuntime'
import {
  DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
  createTaskLifecycle,
  type TaskLifecycle,
} from '../../../features/shared/lifecycle/taskLifecycle'
import {
  createNodeScopedRunCancellation,
} from '../../../features/canvas/execution/nodeScopedRunCancellation'
import { clearCanvasRunStates } from './canvasRunState'

export interface CanvasProjectExecutionRuntime {
  projectId: string
  closed: boolean
  engine: ExecutionRuntime
  operations: TaskLifecycle
  adapterMaps: Map<string, Map<string, ChannelAdapter>>
  taskToNodeMaps: Map<string, Map<string, string>>
  nodeScopedRunCancellation: ReturnType<
    typeof createNodeScopedRunCancellation
  >
  channelInterruptedPlans: Set<string>
  preparingPrompt: Set<string>
  planProgress: Map<string, { done: number; total: number }>
  versionMax: Map<string, number>
  versionInitialization?: Promise<void>
}

const runtimes = new Map<string, CanvasProjectExecutionRuntime>()
const closedProjectIds = new Set<string>()

export class CanvasExecutionRuntimeClosedError extends Error {
  readonly projectId: string

  constructor(projectId: string) {
    super(`项目 ${projectId} 的执行运行时已关闭`)
    this.name = 'CanvasExecutionRuntimeClosedError'
    this.projectId = projectId
  }
}

function createCanvasExecutionRuntime(
  projectId: string,
): CanvasProjectExecutionRuntime {
  return {
    projectId,
    closed: false,
    engine: createExecutionRuntime(),
    operations: createTaskLifecycle(),
    adapterMaps: new Map(),
    taskToNodeMaps: new Map(),
    nodeScopedRunCancellation: createNodeScopedRunCancellation(),
    channelInterruptedPlans: new Set(),
    preparingPrompt: new Set(),
    planProgress: new Map(),
    versionMax: new Map(),
  }
}

export function canvasExecutionRuntimeFor(
  projectId: string,
): CanvasProjectExecutionRuntime {
  const hit = runtimes.get(projectId)
  if (hit) return hit
  if (closedProjectIds.has(projectId)) {
    throw new CanvasExecutionRuntimeClosedError(projectId)
  }
  const runtime = createCanvasExecutionRuntime(projectId)
  runtimes.set(projectId, runtime)
  return runtime
}

/**
 * 只有合法的画布页面激活可以建立新代际。
 *
 * 旧 provider / runNode 闭包仍持有自己捕获的 runtime；它已关闭时不会因为这里
 * 新建了一代而恢复，因此生成入口不能借此复活旧运行时。
 */
export function activateCanvasExecutionRuntime(
  projectId: string,
): CanvasProjectExecutionRuntime {
  closedProjectIds.delete(projectId)
  const hit = runtimes.get(projectId)
  if (hit && !hit.closed) return hit
  const runtime = createCanvasExecutionRuntime(projectId)
  runtimes.set(projectId, runtime)
  return runtime
}

export function peekCanvasExecutionRuntime(
  projectId: string,
): CanvasProjectExecutionRuntime | undefined {
  return runtimes.get(projectId)
}

export function isCanvasExecutionRuntimeClosed(
  projectId: string,
): boolean {
  return closedProjectIds.has(projectId) ||
    runtimes.get(projectId)?.closed === true
}

export function assertCanvasExecutionRuntimeOpen(
  runtime: CanvasProjectExecutionRuntime,
): void {
  if (runtime.closed) {
    throw new CanvasExecutionRuntimeClosedError(runtime.projectId)
  }
}

export function initializeCanvasExecutionVersions(
  projectId: string,
  load: () => Promise<ReadonlyMap<string, number>>,
): Promise<void> {
  const runtime = canvasExecutionRuntimeFor(projectId)
  if (runtime.versionInitialization) return runtime.versionInitialization
  runtime.versionInitialization = load()
    .then((versions) => {
      for (const [nodeId, version] of versions) {
        runtime.versionMax.set(
          nodeId,
          Math.max(runtime.versionMax.get(nodeId) ?? 0, version),
        )
      }
    })
    .catch((error) => {
      runtime.versionInitialization = undefined
      throw error
    })
  return runtime.versionInitialization
}

export function trackCanvasExecutionVersion(
  projectId: string,
  nodeId: string,
  version: number,
): void {
  const runtime = canvasExecutionRuntimeFor(projectId)
  assertCanvasExecutionRuntimeOpen(runtime)
  const versions = runtime.versionMax
  versions.set(nodeId, Math.max(versions.get(nodeId) ?? 0, version))
}

export function nextCanvasExecutionVersion(
  projectId: string,
  nodeId: string,
): number {
  const runtime = canvasExecutionRuntimeFor(projectId)
  assertCanvasExecutionRuntimeOpen(runtime)
  const versions = runtime.versionMax
  const next = (versions.get(nodeId) ?? 0) + 1
  versions.set(nodeId, next)
  return next
}

export interface CanvasExecutionRuntimeShutdown {
  waitForIdle(timeoutMs?: number): Promise<void>
  whenIdle(): Promise<void>
  canReopen(): boolean
  reopenIfIdle(): boolean
  canFinalize(): boolean
  finalize(): boolean
}

/**
 * 同步停止新工作并 abort，把等待 / 最终清理拆成两步。
 *
 * 项目删除必须同时等待 Agent 与 execution；任一方超时都不能先清掉另一方的
 * 注册信息或 store。调用方只在两边都成功后才执行 finalize。
 */
export function beginCanvasExecutionRuntimeShutdown(
  projectId: string,
): CanvasExecutionRuntimeShutdown {
  closedProjectIds.add(projectId)
  const runtime = runtimes.get(projectId)
  if (!runtime) {
    let reopened = false
    return {
      waitForIdle: async () => undefined,
      whenIdle: async () => undefined,
      canReopen: () => !reopened && runtimes.get(projectId) === undefined,
      reopenIfIdle() {
        if (reopened || runtimes.get(projectId) !== undefined) return false
        reopened = true
        closedProjectIds.delete(projectId)
        return true
      },
      canFinalize: () => !reopened,
      finalize() {
        if (reopened) return false
        closedProjectIds.add(projectId)
        return true
      },
    }
  }
  runtime.closed = true
  const operationsAttempt = runtime.operations.beginClose()
  const engineAttempt = runtime.engine.beginClose()
  let finalized = false
  const canReopen = () =>
    !finalized &&
    runtime.operations.canReopen(operationsAttempt) &&
    runtime.engine.canReopen(engineAttempt)
  const canFinalize = () =>
    !finalized &&
    runtime.operations.canFinalize(operationsAttempt) &&
    runtime.engine.canFinalize(engineAttempt)
  return {
    waitForIdle: (timeoutMs = DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS) =>
      Promise.all([
        runtime.operations.waitForIdle(timeoutMs),
        runtime.engine.waitForIdle(timeoutMs),
      ]).then(() => undefined),
    whenIdle: () =>
      Promise.all([
        runtime.operations.whenIdle(),
        runtime.engine.whenIdle(),
      ]).then(() => undefined),
    canReopen,
    reopenIfIdle() {
      if (!canReopen()) return false
      runtime.operations.reopenIfIdle(operationsAttempt)
      runtime.engine.reopenIfIdle(engineAttempt)
      runtime.closed = false
      closedProjectIds.delete(projectId)
      return true
    },
    canFinalize,
    finalize() {
      if (!canFinalize()) return false
      finalized = true
      runtime.operations.finalizeClose(operationsAttempt)
      runtime.engine.finalizeClose(engineAttempt)
      runtime.adapterMaps.clear()
      runtime.taskToNodeMaps.clear()
      runtime.channelInterruptedPlans.clear()
      runtime.preparingPrompt.clear()
      runtime.planProgress.clear()
      runtime.versionMax.clear()
      if (runtimes.get(projectId) !== runtime) return true
      clearCanvasRunStates(projectId)
      runtimes.delete(projectId)
      return true
    },
  }
}

export async function disposeCanvasExecutionRuntime(
  projectId: string,
  timeoutMs = DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const shutdown = beginCanvasExecutionRuntimeShutdown(projectId)
  await shutdown.waitForIdle(timeoutMs)
  if (!shutdown.finalize()) {
    throw new Error(`项目 ${projectId} 的执行运行时未能安全关闭`)
  }
}

export async function disposeAllCanvasExecutionRuntimes(): Promise<void> {
  const projectIds = [...runtimes.keys()]
  await Promise.all(
    projectIds.map((projectId) =>
      disposeCanvasExecutionRuntime(projectId)),
  )
}

export function canvasExecutionRuntimeProjectIds(): string[] {
  return [...runtimes.keys()]
}

export function resetCanvasExecutionRuntimesForTests(): void {
  runtimes.clear()
  closedProjectIds.clear()
}
