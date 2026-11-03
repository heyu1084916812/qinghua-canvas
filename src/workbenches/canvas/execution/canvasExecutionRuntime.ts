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
  finalize(): void
}

/**
 * 同步停止新工作并 abort，把等待 / 最终清理拆成两步。
 *
 * 项目删除必须同时等待 Agent 与 execution；任一方超时都不能先清掉另一方的
 * 注册信息或 store。调用方只在两边都成功后才执行 finalize。
 */
export function beginCanvasExecutionRuntimeShutdown(
  projectId: string,
): CanvasExecutionRuntimeShutdown | null {
  closedProjectIds.add(projectId)
  const runtime = runtimes.get(projectId)
  if (!runtime) return null
  runtime.closed = true
  runtime.operations.beginClose()
  runtime.engine.beginClose()
  let finalized = false
  return {
    waitForIdle: (timeoutMs = DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS) =>
      Promise.all([
        runtime.operations.waitForIdle(timeoutMs),
        runtime.engine.waitForIdle(timeoutMs),
      ]).then(() => undefined),
    finalize() {
      if (finalized) return
      finalized = true
      runtime.engine.finalizeClose()
      runtime.adapterMaps.clear()
      runtime.taskToNodeMaps.clear()
      runtime.channelInterruptedPlans.clear()
      runtime.preparingPrompt.clear()
      runtime.planProgress.clear()
      runtime.versionMax.clear()
      if (runtimes.get(projectId) !== runtime) return
      clearCanvasRunStates(projectId)
      runtimes.delete(projectId)
    },
  }
}

export async function disposeCanvasExecutionRuntime(
  projectId: string,
  timeoutMs = DEFAULT_TASK_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  const shutdown = beginCanvasExecutionRuntimeShutdown(projectId)
  if (!shutdown) return
  await shutdown.waitForIdle(timeoutMs)
  shutdown.finalize()
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
