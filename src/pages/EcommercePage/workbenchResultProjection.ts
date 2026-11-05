import {
  freshestResultsById,
  resultDisplayStatus,
  type EcommerceDisplayResultStatus,
  type EcommerceResultLiveState,
  type EcommerceResultRecord,
  type EcommerceTaskRecord,
} from '../../domain/ecommerce/tasks'
import type { RunRecord } from '../../domain/shared/execution/runRecord'

export interface WorkbenchResultProjection {
  latestResultById: Map<string, EcommerceResultRecord>
  taskById: Map<string, EcommerceTaskRecord>
  latestRunByNode: Map<string, RunRecord>
}

export function projectWorkbenchResults(
  results: readonly EcommerceResultRecord[],
  activeResults: readonly EcommerceResultRecord[] | undefined,
  tasks: readonly EcommerceTaskRecord[],
  runs: readonly RunRecord[] | undefined,
): WorkbenchResultProjection {
  const latestRunByNode = new Map<string, RunRecord>()
  for (const run of [...runs ?? []].sort((a, b) => b.createdAt - a.createdAt)) {
    const nodeId = run.subjectId
    if (nodeId && !latestRunByNode.has(nodeId)) latestRunByNode.set(nodeId, run)
  }
  return {
    latestResultById: freshestResultsById(results, activeResults ?? []),
    taskById: new Map(tasks.map((task) => [task.id, task] as const)),
    latestRunByNode,
  }
}

export function workbenchDisplayStatusOf(
  result: EcommerceResultRecord,
  projection: WorkbenchResultProjection,
): EcommerceDisplayResultStatus {
  const run = projection.latestRunByNode.get(result.nodeId)
  return resultDisplayStatus({
    stored: result.status,
    hasAsset: !!result.assetHash,
    ...(run ? { live: run.status as EcommerceResultLiveState } : {}),
  })
}
