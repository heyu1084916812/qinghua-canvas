import type { GenerationContextAsset } from '../../../../domain/canvas/model/node'
import type {
  ExtractDeps,
  ExtractInput,
} from '../../../../features/canvas/extractSelection'
import type {
  SplitDeps,
  SplitInput,
} from '../../../../features/canvas/splitToGrid'
import type { AgentToolContext } from '../../agent/tools'
import type { AgentCanvasRunDeps } from './agentCanvasRun'
import { imageContextAssets } from './agentToolContextAssets'

type RunNodes = NonNullable<AgentToolContext['runNodes']>
type SliceImage = NonNullable<AgentToolContext['sliceImage']>
type SplitGrid = NonNullable<AgentToolContext['splitGrid']>

export interface AgentToolCanvasOpsInput {
  sessionId: string
  store: ExtractDeps['store']
  platform: ExtractDeps['platform']
  execution: AgentCanvasRunDeps['execution']
  channels: AgentCanvasRunDeps['channels']
  setRunTasksFor: AgentCanvasRunDeps['setRunTasksFor']
  runCanvasNodes: (
    deps: AgentCanvasRunDeps,
    input: {
      sessionId: string
      nodeIds: readonly string[]
      signal?: AbortSignal
    },
  ) => ReturnType<RunNodes>
  cropAsset: (
    deps: ExtractDeps,
    input: ExtractInput,
  ) => ReturnType<SliceImage>
  extractSelection: (
    deps: ExtractDeps,
    input: ExtractInput,
  ) => ReturnType<SliceImage>
  splitNodeToGrid: (
    deps: SplitDeps,
    input: SplitInput,
  ) => ReturnType<SplitGrid>
  /**
   * 调用时现取：工具可能等到用户点「批准」才执行，那一刻的上下文素材才是对的。
   */
  getContextAssets: () =>
    | readonly GenerationContextAsset[]
    | null
    | undefined
}

export interface AgentToolCanvasOps {
  runNodes: RunNodes
  sliceImage: SliceImage
  splitGrid: SplitGrid
}

/**
 * 工具层的三个画布副作用端口：跑节点、裁剪/提取选区、宫格切分。
 *
 * 两条不变量（改这里前先看 `agentToolCanvasOps.test.ts`）：
 * 1. `runNodes` 的上下文素材**只留图片**，且与 `contextAssetsForGenerated`
 *    共用 `imageContextAssets` 同一条规则 —— 两处各写一遍就会出现
 *    「跑的时候带了图、建节点时却不带」这种没人报得出来的哑分歧。
 * 2. `signal` 原样透传：丢了它，停止按钮对"跑节点"就无效，任务停不下来还继续扣费。
 */
export function createAgentToolCanvasOps(
  input: AgentToolCanvasOpsInput,
): AgentToolCanvasOps {
  return {
    runNodes: (ids, signal) =>
      input.runCanvasNodes(
        {
          store: input.store,
          execution: input.execution,
          channels: input.channels,
          platform: input.platform,
          contextAssets: imageContextAssets(input.getContextAssets()),
          setRunTasksFor: input.setRunTasksFor,
        },
        {
          sessionId: input.sessionId,
          nodeIds: ids,
          ...(signal ? { signal } : {}),
        },
      ),
    sliceImage: (nodeId, mode, rect, ratio) => {
      const run =
        mode === 'crop' ? input.cropAsset : input.extractSelection
      return run(
        { platform: input.platform, store: input.store },
        { nodeId, rect, ...(ratio ? { ratio } : {}) },
      )
    },
    splitGrid: (nodeId, rows, cols) =>
      input.splitNodeToGrid(
        { platform: input.platform, store: input.store },
        { nodeId, rows, cols },
      ),
  }
}
