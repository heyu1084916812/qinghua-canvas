import type { ChannelAdapter } from '../../../platform/channels/types'
import {
  createExecutionRuntime,
  type ExecutionRuntime,
} from '../../../features/shared/execution/executionRuntime'
import {
  createNodeScopedRunCancellation,
} from '../../../features/canvas/execution/nodeScopedRunCancellation'
import { clearCanvasRunStates } from './canvasRunState'

export interface CanvasProjectExecutionRuntime {
  projectId: string
  engine: ExecutionRuntime
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

export function canvasExecutionRuntimeFor(
  projectId: string,
): CanvasProjectExecutionRuntime {
  const hit = runtimes.get(projectId)
  if (hit) return hit
  const runtime: CanvasProjectExecutionRuntime = {
    projectId,
    engine: createExecutionRuntime(),
    adapterMaps: new Map(),
    taskToNodeMaps: new Map(),
    nodeScopedRunCancellation: createNodeScopedRunCancellation(),
    channelInterruptedPlans: new Set(),
    preparingPrompt: new Set(),
    planProgress: new Map(),
    versionMax: new Map(),
  }
  runtimes.set(projectId, runtime)
  return runtime
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
  const versions = canvasExecutionRuntimeFor(projectId).versionMax
  versions.set(nodeId, Math.max(versions.get(nodeId) ?? 0, version))
}

export function nextCanvasExecutionVersion(
  projectId: string,
  nodeId: string,
): number {
  const versions = canvasExecutionRuntimeFor(projectId).versionMax
  const next = (versions.get(nodeId) ?? 0) + 1
  versions.set(nodeId, next)
  return next
}

export async function disposeCanvasExecutionRuntime(
  projectId: string,
): Promise<void> {
  const runtime = runtimes.get(projectId)
  if (!runtime) return
  runtimes.delete(projectId)
  runtime.engine.dispose()
  runtime.adapterMaps.clear()
  runtime.taskToNodeMaps.clear()
  runtime.channelInterruptedPlans.clear()
  runtime.preparingPrompt.clear()
  runtime.planProgress.clear()
  runtime.versionMax.clear()
  clearCanvasRunStates(projectId)
  await Promise.resolve()
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
