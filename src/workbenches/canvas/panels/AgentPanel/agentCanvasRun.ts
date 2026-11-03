import type { CanvasExecutionApi } from '../../execution/CanvasExecutionProvider'
import type { AgentToolContext } from '../../agent/tools'
import { errText } from '../../agent/agentLoop'
import { agentRunOutcomeOf } from '../../agent/runOutcome'
import { runPreflightProblems } from '../../agent/runPreflight'
import { runWaves } from '../../../../domain/canvas/graph/runWaves'
import type { RunRecord } from '../../../../domain/canvas/model/runRecord'
import type { GenerationContextAsset } from '../../../../domain/canvas/model/node'
import type { ChannelStore } from '../../../../state/channel/channelStore'
import type { PlatformKit } from '../../../../platform/ports'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { AgentRunTask } from './agentRunTasks'
import {
  createAgentRunTasks,
  finishAgentRunTask,
  startAgentRunWave,
} from './agentRunTasks'

export interface AgentCanvasRunDeps {
  store: Pick<CanvasStore, 'getSnapshot' | 'flush'>
  execution: Pick<CanvasExecutionApi, 'runNode'>
  channels: Pick<ChannelStore, 'getState' | 'protocolCatalog'>
  platform: Pick<PlatformKit, 'storage'>
  contextAssets: readonly GenerationContextAsset[]
  setRunTasksFor(
    sessionId: string,
    update:
      | AgentRunTask[]
      | ((current: AgentRunTask[]) => AgentRunTask[]),
  ): void
}

export function agentCanvasFailureText(error: unknown): string {
  return errText(error)
}

type AgentRunNodesResult = Awaited<ReturnType<AgentToolContext['runNodes']>>

/**
 * 按依赖波次并发运行画布节点，并以持久 RunRecord 对账。
 *
 * 这个函数负责副作用顺序：preflight -> 同波并发 -> store.flush -> 读新记录。
 * 任何地方都不能因为“没查到记录”而重发付费请求。
 */
export async function runAgentCanvasNodes(
  deps: AgentCanvasRunDeps,
  input: {
    sessionId: string
    nodeIds: readonly string[]
    signal?: AbortSignal
  },
): Promise<AgentRunNodesResult> {
  const { store, execution, channels, platform, setRunTasksFor } = deps
  const { sessionId, nodeIds: ids, signal } = input
  const titleOf = (id: string): string => {
    const node = store.getSnapshot().nodes.find((item) => item.id === id)
    const data = (node?.data ?? {}) as { title?: unknown }
    return (
      (node?.title ?? '').trim() ||
      (typeof data.title === 'string' ? data.title.trim() : '')
    )
  }
  const preflightFailureText = (problem: string): string =>
    problem.includes('无法运行：')
      ? problem.slice(problem.indexOf('无法运行：') + '无法运行：'.length)
      : problem

  const waves = runWaves(ids, store.getSnapshot().edges)
  setRunTasksFor(
    sessionId,
    createAgentRunTasks(
      ids.map((id) => ({
        nodeId: id,
        title: titleOf(id) || id,
      })),
    ),
  )
  const out: AgentRunNodesResult = []
  for (const wave of waves) {
    setRunTasksFor(sessionId, (current) => startAgentRunWave(current, wave))
    const projectId = store.getSnapshot().projectId
    const beforeRows = (await platform.storage.query('runRecords', {
      projectId,
    })) as unknown as RunRecord[]
    const beforeIds = new Set(beforeRows.map((record) => record.id))
    const thrown = await Promise.all(
      wave.map(async (id) => {
        const problem = runPreflightProblems(
          [id],
          store.getSnapshot(),
          channels.getState().channels,
          channels.protocolCatalog(),
        )[0]
        if (problem) {
          setRunTasksFor(sessionId, (current) =>
            finishAgentRunTask(current, id, {
              ok: false,
              error: preflightFailureText(problem),
            }),
          )
          return {
            nodeId: id,
            ok: false,
            error: preflightFailureText(problem),
          }
        }
        try {
          await execution.runNode(id, {
            signal,
            ...(deps.contextAssets.length > 0
              ? { contextAssets: deps.contextAssets }
              : {}),
          })
          setRunTasksFor(sessionId, (current) =>
            finishAgentRunTask(current, id, { ok: true }),
          )
          return null
        } catch (error) {
          const message = agentCanvasFailureText(error)
          setRunTasksFor(sessionId, (current) =>
            finishAgentRunTask(current, id, {
              ok: false,
              error: message,
            }),
          )
          return {
            nodeId: id,
            ok: false,
            error: message,
          }
        }
      }),
    )
    await store.flush()
    let outcomes: ReturnType<typeof agentRunOutcomeOf>[] = []
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const afterRows = (await platform.storage.query('runRecords', {
        projectId,
      })) as unknown as RunRecord[]
      outcomes = wave.map((id, index) => {
        const failure = thrown[index]
        const fallbackProblem = failure
          ? undefined
          : runPreflightProblems(
              [id],
              store.getSnapshot(),
              channels.getState().channels,
              channels.protocolCatalog(),
            )[0]
        const base =
          failure ??
          agentRunOutcomeOf(
            afterRows,
            id,
            beforeIds,
            fallbackProblem
              ? preflightFailureText(fallbackProblem)
              : undefined,
          )
        const title = titleOf(id)
        return title ? { ...base, title } : base
      })
      if (
        !outcomes.some((outcome) =>
          outcome.error?.includes('没有留下记录'),
        )
      ) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    for (const outcome of outcomes) {
      setRunTasksFor(sessionId, (current) =>
        finishAgentRunTask(current, outcome.nodeId, {
          ok: outcome.ok,
          ...(outcome.error ? { error: outcome.error } : {}),
        }),
      )
    }
    out.push(...outcomes)
  }
  return out
}
