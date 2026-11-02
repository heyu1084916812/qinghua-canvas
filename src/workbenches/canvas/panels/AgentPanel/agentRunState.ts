import type { RunRecord } from '../../../../domain/canvas/model/runRecord'
import type { StoragePort } from '../../../../platform/ports'

export interface AgentRunFailureState {
  kind: 'failed'
  reason: string
}

/**
 * 执行层完成一次任务后会清掉节点的瞬时状态，但 RunRecord 会永久保留。
 * `readResult` 必须看这份持久真相，不能只看 execution.nodeStates。
 */
export function latestRunFailureOf(
  records: readonly RunRecord[],
): AgentRunFailureState | undefined {
  const latest = [...records].sort(
    (left, right) =>
      right.createdAt - left.createdAt || right.version - left.version,
  )[0]
  if (!latest || latest.status !== 'failed') return undefined
  return {
    kind: 'failed',
    reason: latest.errorText?.trim() || '最近一次运行失败，但没有留下可读原因。',
  }
}

export async function latestRunFailuresForNodes(
  storage: StoragePort,
  projectId: string,
  nodeIds: readonly string[],
): Promise<ReadonlyMap<string, AgentRunFailureState>> {
  const ids = [...new Set(nodeIds.filter(Boolean))].slice(0, 64)
  const pairs = await Promise.all(
    ids.map(async (nodeId) => {
      const rows = (await storage.query('runRecords', {
        projectId,
        nodeId,
      })) as unknown as RunRecord[]
      return [nodeId, latestRunFailureOf(rows)] as const
    }),
  )
  return new Map(
    pairs.filter(
      (pair): pair is readonly [string, AgentRunFailureState] =>
        pair[1] !== undefined,
    ),
  )
}
