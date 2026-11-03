import type { RunTaskState } from '../../../features/shared/execution/runEngine'

const runStatesByProject = new Map<string, Map<string, RunTaskState>>()
const runStateListeners = new Map<string, Set<() => void>>()

export function canvasRunStatesOf(
  projectId: string,
): Map<string, RunTaskState> {
  const hit = runStatesByProject.get(projectId)
  if (hit) return hit
  const fresh = new Map<string, RunTaskState>()
  runStatesByProject.set(projectId, fresh)
  return fresh
}

export function canvasRunIsRunning(projectId: string): boolean {
  for (const state of canvasRunStatesOf(projectId).values()) {
    if (state.kind === 'queued' || state.kind === 'running') return true
  }
  return false
}

export function updateCanvasRunStates(
  projectId: string,
  update: (
    previous: Map<string, RunTaskState>,
  ) => Map<string, RunTaskState>,
): void {
  runStatesByProject.set(
    projectId,
    update(canvasRunStatesOf(projectId)),
  )
  for (const listener of runStateListeners.get(projectId) ?? []) {
    listener()
  }
}

export function updateCanvasRunState(
  projectId: string,
  nodeId: string,
  state: RunTaskState,
): void {
  updateCanvasRunStates(
    projectId,
    (previous) => new Map(previous).set(nodeId, state),
  )
}

export function subscribeCanvasRunStates(
  projectId: string,
  listener: () => void,
): () => void {
  let listeners = runStateListeners.get(projectId)
  if (!listeners) {
    listeners = new Set()
    runStateListeners.set(projectId, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearCanvasRunStates(projectId: string): void {
  runStatesByProject.delete(projectId)
  for (const listener of runStateListeners.get(projectId) ?? []) {
    listener()
  }
  runStateListeners.delete(projectId)
}

export function resetCanvasRunStatesForTests(): void {
  runStatesByProject.clear()
  runStateListeners.clear()
}
