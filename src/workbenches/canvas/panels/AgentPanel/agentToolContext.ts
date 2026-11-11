import type { AgentNodeType } from '../../../../domain/agent/plan'
import type { CanvasStore } from '../../../../state/workbenches/canvas/store'
import type { AgentToolContext } from '../../agent/tools'
import type { AgentToolCanvasOps } from './agentToolCanvasOps'
import type { AgentNodeDefaults } from './agentToolDefaults'
import type { AgentToolPlanPorts } from './agentToolPlanPorts'
import type { AgentToolRecipeContext } from './agentToolRecipeContext'
import type { AgentToolResearch } from './agentToolResearch'

/** `createAgentToolDefaults` 的返回形状（结构对位，不反向依赖工厂）。 */
export interface AgentToolDefaults {
  defaultsForNewNode: (
    types: readonly AgentNodeType[],
  ) => Promise<AgentNodeDefaults>
}

/**
 * 建 ctx 时**一次性现取**的那批值（不是端口）。
 *
 * `abortSignal` / `perImage` 必须是值：它们在「建上下文」这一刻读 ref，
 * 粒度就是一次工具调用（`agentLoopDeps` 每个工具调用建一次 ctx）。
 * 别改成 thunk —— 工具执行时读到的是下一回合的信号，停止语义会变。
 */
export interface AgentToolBase {
  store: CanvasStore
  origin: { x: number; y: number }
  /** 建 ctx 时由宿主算好的可见世界矩形（`viewportWorldOf(viewport)`）。 */
  viewportWorld: NonNullable<AgentToolContext['viewportWorld']>
  projectId: string
  /** 空串 = 这次调用没有会话（此时**不出** `taskPlan` 键）。 */
  sessionId: string
  selection: readonly string[]
  selectedModelOf: NonNullable<AgentToolContext['selectedModelOf']>
  /** 没有信号时**不出** `signal` 键。 */
  abortSignal?: AbortSignal
  /** false 时**不出** `perImage` 键。 */
  perImage: boolean
}

export interface ComposeAgentToolContextInput {
  base: AgentToolBase
  /** 没有会话时传 undefined：**不出** `taskPlan` 键。 */
  plan?: AgentToolPlanPorts
  /** 调用时现取的 localId 别名表（applyPlan 之后才写，不能在 build 时快照）。 */
  resolveAliases: () => Map<string, string> | undefined
  recipe: AgentToolRecipeContext
  research: AgentToolResearch
  defaults: AgentToolDefaults
  canvasOps: AgentToolCanvasOps
}

/**
 * 把「已经建好的几块」拼成 `AgentToolContext`。
 *
 * 这里没有端口、没有副作用，只有一条硬契约：**条件键的存在性**。
 * `taskPlan` / `signal` / `perImage` 在不成立时**不出键**（不是出 `undefined`）——
 * 工具层用 `ctx.signal` / `ctx.taskPlan` / `ctx.perImage` 做真值判断，
 * 拍平成 undefined 现在看着无害，但一旦有人改成 `in` 判断就静默变行为。
 * `agentToolContext.test.ts` 用 `'signal' in ctx === false` 这类断言钉住。
 */
export function composeAgentToolContext(
  input: ComposeAgentToolContextInput,
): AgentToolContext {
  const { base } = input
  return {
    store: base.store,
    viewportWorld: base.viewportWorld,
    memoryContext: {
      workbench: 'canvas',
      projectId: base.projectId,
      ...(base.sessionId ? { sessionId: base.sessionId } : {}),
    },
    ...(input.plan ? { taskPlan: input.plan } : {}),
    origin: base.origin,
    selectedIds: () => base.selection,
    selectedModelOf: base.selectedModelOf,
    ...(base.abortSignal ? { signal: base.abortSignal } : {}),
    ...(base.perImage ? { perImage: true } : {}),
    resolveNodeIds: (ids) => {
      const aliases = input.resolveAliases()
      return ids.map((id) => aliases?.get(id) ?? id)
    },
    ...input.canvasOps,
    defaultsForNewNode: input.defaults.defaultsForNewNode,
    ...input.recipe,
    rememberMemory: input.research.rememberMemory,
    researchDesign: input.research.researchDesign,
    readPage: input.research.readPage,
  }
}
