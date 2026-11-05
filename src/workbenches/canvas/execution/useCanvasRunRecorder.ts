import {
  useCallback,
  useEffect,
} from 'react'
import type { FuseOutcome } from '../../../features/canvas/execution/fuseNode'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type {
  FusionData,
  NodeSnapshot,
} from '../../../domain/canvas/model/node'
import {
  LOCAL_RUN_CHANNEL_ID,
  createRunRecord,
  type RunRecord,
} from '../../../domain/canvas/model/runRecord'
import { fusionSpec } from '../../../domain/canvas/nodeSpecs/fusion'
import type { WorkbenchId } from '../../../domain/shared/workbench'
import type { PlatformKit } from '../../../platform/ports'
import { createId } from '../../../shared/id'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  initializeCanvasExecutionVersions,
  nextCanvasExecutionVersion,
  trackCanvasExecutionVersion,
  type CanvasProjectExecutionRuntime,
} from './canvasExecutionRuntime'
import { emitRunRecordChanged } from './runRecordEvents'

type RecorderStore = Pick<CanvasStore, 'dispatch' | 'flush' | 'getSnapshot'>

export interface CanvasRunRecorderInput {
  projectId: string
  runtime: CanvasProjectExecutionRuntime
  store: RecorderStore
  storage: PlatformKit['storage']
}

export interface AppendFusionRunRecordInput {
  node: NodeSnapshot<FusionData>
  outcome: FuseOutcome
  startedAt: number
  durationMs: number
  operationId: string
  workbench: WorkbenchId
}

export interface CanvasRunRecorder {
  nextVersion(nodeId: string): number
  appendRecord(record: RunRecord): Promise<void>
  appendFusionRecord(input: AppendFusionRunRecordInput): Promise<void>
}

export function fusionRunRecordSubjectId(
  fusionNodeId: string,
  outcome: FuseOutcome,
): string {
  return outcome.ok ? outcome.resultNodeId : fusionNodeId
}

export function createFusionRunRecord(args: {
  node: NodeSnapshot<FusionData>
  outcome: FuseOutcome
  graphAfter: GraphSnapshot
  subjectNodeId: string
  version: number
  startedAt: number
  durationMs: number
  operationId: string
  workbench: WorkbenchId
}): RunRecord {
  const {
    node,
    outcome,
    graphAfter,
    subjectNodeId,
    version,
    startedAt,
    durationMs,
    operationId,
    workbench,
  } = args
  const outputHash = outcome.ok
    ? ((graphAfter.nodes.find((item) => item.id === outcome.resultNodeId)?.data as
        | { assetHash?: string }
        | undefined)?.assetHash ?? '')
    : ''

  return createRunRecord({
    id: createId('rec'),
    nodeId: subjectNodeId,
    projectId: graphAfter.projectId,
    version,
    createdAt: startedAt,
    status: outcome.ok ? 'succeeded' : 'failed',
    inputs: fusionSpec.collectInputs({
      node,
      graph: graphAfter,
    }),
    params: node.data,
    outputHashes: outputHash ? [outputHash] : [],
    fingerprint: 'fusion',
    taskId: createId('task'),
    durationMs,
    sentChannelId: LOCAL_RUN_CHANNEL_ID,
    sentModel: '本地融合',
    ...(outcome.ok ? {} : { errorText: outcome.reason }),
    scope: {
      scopeVersion: 1,
      workbench,
      subjectId: subjectNodeId,
      scopeId: `fusion:${node.id}:${operationId}`,
      operationId,
    },
  })
}

/**
 * 只拥有引擎外的 RunRecord 写入与版本账本。
 *
 * 正常生成记录仍由 shared runEngine/placement 创建；本 Hook 不持有
 * recordScope、运行生命周期、路由、取消或 launching 顺序。
 */
export function useCanvasRunRecorder({
  projectId,
  runtime,
  store,
  storage,
}: CanvasRunRecorderInput): CanvasRunRecorder {
  const nextVersion = useCallback(
    (nodeId: string): number => nextCanvasExecutionVersion(projectId, nodeId),
    [projectId],
  )

  const appendRecord = useCallback(
    (record: RunRecord) =>
      runtime.operations.track(async () => {
        trackCanvasExecutionVersion(projectId, record.nodeId, record.version)
        store.dispatch({
          kind: 'node.runRecord.append',
          nodeId: record.nodeId,
          record,
        })
        await store.flush()
        emitRunRecordChanged()
      }),
    [projectId, runtime, store],
  )

  const appendFusionRecord = useCallback(
    async (input: AppendFusionRunRecordInput): Promise<void> => {
      const graphAfter = store.getSnapshot()
      const subjectNodeId = fusionRunRecordSubjectId(input.node.id, input.outcome)
      await appendRecord(
        createFusionRunRecord({
          ...input,
          graphAfter,
          subjectNodeId,
          version: nextVersion(subjectNodeId),
        }),
      )
    },
    [appendRecord, nextVersion, store],
  )

  const initializeVersionBaseline = useCallback(
    () =>
      initializeCanvasExecutionVersions(
        projectId,
        async () => {
          const rows = await storage.query('runRecords', { projectId })
          const byNode = new Map<string, number>()
          for (const row of rows as unknown as RunRecord[]) {
            byNode.set(
              row.nodeId,
              Math.max(byNode.get(row.nodeId) ?? 0, row.version),
            )
          }
          return byNode
        },
      ),
    [projectId, storage],
  )

  useEffect(() => {
    void initializeVersionBaseline().catch(() => undefined)
  }, [initializeVersionBaseline])

  return {
    nextVersion,
    appendRecord,
    appendFusionRecord,
  }
}
