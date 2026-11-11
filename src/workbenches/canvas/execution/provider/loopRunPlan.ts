/** 循环节点逐轮冻结输入、合并下游任务并统一重排输出槽位。 */
import {
  buildRunPlan,
  type CanvasRunTask,
  type RunPlan,
} from '../../../../features/canvas/execution/buildRunPlan'
import {
  hasRunnableDownstream,
  loopUpstreamAssets,
  loopUpstreamPrompts,
  planLoopRounds,
} from '../../../../features/canvas/execution/loopRun'
import { generatedNodeTitle } from '../../../../domain/canvas/naming/autoTitle'
import { directDownstream } from '../../../../domain/canvas/graph/upstreamOf'
import type { GraphSnapshot } from '../../../../domain/canvas/model/graph'
import type {
  GenerationContextAsset,
  LoopData,
  NodeSnapshot,
} from '../../../../domain/canvas/model/node'
import { createId } from '../../../../shared/id'
import { canceledRun, failedRun, type CanvasRunLaunchResult } from '../canvasRunPreflight'

export interface CanvasLoopRunPorts {
  graph: GraphSnapshot
  getSnapshot: () => GraphSnapshot
  dispatch: (command: {
    kind: 'node.updateData'
    id: string
    patch: Record<string, unknown>
    transient: boolean
  }) => unknown
  notify: (text: string, tone?: 'info' | 'error') => void
  flush: () => Promise<void>
  activeRunNodeIds: () => ReadonlySet<string>
  launch: (
    plan: RunPlan,
    originNodeId: string,
    signal?: AbortSignal,
  ) => Promise<CanvasRunLaunchResult>
}

export function sourceOfLoopTask(task: CanvasRunTask): string {
  return task.slot.kind === 'new' ? task.slot.connectFrom : task.nodeId
}

export function arrangeLoopTasks(
  allTasks: readonly CanvasRunTask[],
  graph: GraphSnapshot,
): CanvasRunTask[] {
  const totals = new Map<string, number>()
  for (const task of allTasks) {
    const from = sourceOfLoopTask(task)
    totals.set(from, (totals.get(from) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const assignedTitles: string[] = []
  return allTasks.map((task, index) => {
    const from = sourceOfLoopTask(task)
    const fromNode = graph.nodes.find((node) => node.id === from)
    const outputIndex = seen.get(from) ?? 0
    seen.set(from, outputIndex + 1)
    const outputTotal = totals.get(from) ?? 1
    const autoTitle = generatedNodeTitle({
      prompt: task.request.prompt,
      mode: task.request.kind === 'video' ? 'video' : 'image',
      slotKind: 'new',
      sourceTitle: task.sourceTitle,
      targetTitle: task.targetTitle,
      materialTitle: task.materialTitle,
      presetName: task.presetName,
      existingTitles: [
        ...graph.nodes.map((node) => node.title),
        ...assignedTitles,
      ],
      index: outputIndex,
      total: outputTotal,
    })
    assignedTitles.push(autoTitle)
    return {
      ...task,
      slot: {
        kind: 'new' as const,
        title: `${fromNode?.title ?? '生成'}的输出${index + 1}`,
        connectFrom: from,
      },
      seq: index,
      callCount: allTasks.length,
      outputIndex,
      outputTotal,
      autoTitle,
    }
  })
}

export async function runCanvasLoop(
  loopNode: NodeSnapshot<LoopData>,
  contextAssets: readonly GenerationContextAsset[] | undefined,
  signal: AbortSignal | undefined,
  ports: CanvasLoopRunPorts,
): Promise<CanvasRunLaunchResult> {
  if (signal?.aborted) return canceledRun()
  const rounds = planLoopRounds(
    loopNode,
    loopUpstreamAssets(loopNode, ports.graph),
    loopUpstreamPrompts(loopNode, ports.graph),
  )
  if (rounds.length === 0) {
    const message = '循环次数为 0，没有可跑的轮次'
    ports.notify(message, 'error')
    return failedRun(`loop:${loopNode.id}`, loopNode.id, message)
  }
  if (!hasRunnableDownstream(loopNode, ports.graph)) {
    const message = '循环节点下游还没有生成节点，无法运行'
    ports.notify(message, 'error')
    return failedRun(`loop:${loopNode.id}`, loopNode.id, message)
  }
  const downstreamIds = directDownstream(loopNode.id, ports.graph.edges)
    .map((id) => ports.graph.nodes.find((node) => node.id === id))
    .filter((node): node is NodeSnapshot => !!node)
    .filter((node) => node.type === 'generation' || node.type === 'batch')
    .map((node) => node.id)

  try {
    const allTasks: CanvasRunTask[] = []
    for (const round of rounds) {
      if (signal?.aborted) return canceledRun()
      ports.dispatch({
        kind: 'node.updateData',
        id: loopNode.id,
        patch: {
          __roundPrompt: round.prompt,
          __roundAssets: round.assetHashes,
          lastRoundIndex: round.index,
          lastRoundPrompt: round.prompt,
          lastRoundAssets: round.assetHashes,
        },
        transient: true,
      })
      let added = 0
      for (const nodeId of downstreamIds) {
        const plan = buildRunPlan(
          'node',
          { originNodeId: nodeId },
          ports.getSnapshot(),
          'single-alt',
          {
            reservedNodeIds: ports.activeRunNodeIds(),
            ...(contextAssets?.length ? { contextAssets } : {}),
          },
        )
        if (plan.tasks.length === 0) continue
        allTasks.push(...plan.tasks)
        added += 1
      }
      if (added === 0) {
        const message =
          round.prompt || round.assetHashes.length > 0
            ? `第 ${round.index} 轮无法构建请求，已停止`
            : `第 ${round.index} 轮没有可用的提示词或图片，已停止（在下游节点写提示词，或在循环节点写一条）`
        ports.notify(message, 'error')
        return failedRun(`loop:${loopNode.id}`, loopNode.id, message)
      }
    }
    if (allTasks.length === 0) {
      const message = '没有可执行的轮次'
      ports.notify(message, 'error')
      return failedRun(`loop:${loopNode.id}`, loopNode.id, message)
    }
    const merged: RunPlan = {
      id: createId('plan'),
      scope: 'node',
      mode: 'single',
      tasks: arrangeLoopTasks(allTasks, ports.graph),
    }
    return await ports.launch(merged, loopNode.id, signal)
  } finally {
    ports.dispatch({
      kind: 'node.updateData',
      id: loopNode.id,
      patch: { __roundPrompt: undefined, __roundAssets: undefined },
      transient: true,
    })
    void ports.flush()
  }
}
