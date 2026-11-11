import {
  alignGenerationMode,
  type AgentNodeType,
  type AgentPlan,
} from '../../../domain/agent/plan'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { GenerationContextAsset } from '../../../domain/canvas/model/node'
import type { Rect } from '../../../domain/agent/landing'
import type { AppError } from '../../../shared/result'
import { downstreamOf } from '../../../domain/canvas/graph/upstreamOf'
import { canBuildRequest } from '../../../features/canvas/execution/buildRunPlan'
import { applyAgentPlan } from './applyAgentPlan'
import { discoverAgentTools } from './toolCatalog'
import type { AgentRunOutcome } from './runOutcome'
import { createId } from '../../../shared/id'
import { placeNodeWithoutOverlap } from './agentGeometry'
import {
  arrangeNodesInStore,
  compareNodesInStore,
  deleteEdgesInStore,
  deleteNodesInStore,
  moveNodesInStore,
  resizeNodesInStore,
} from './agentCanvasMutationTools'
import { planProblems } from './agentPlanGate'
import {
  memoryCandidateProblems,
  normalizeMemoryCandidate,
  type MemoryCandidate,
} from '../../../domain/shared/memoryOrganizer'
import type { VisualReviewResult } from '../../../domain/agent/visualReview'
import type { ReferenceCurationResult } from '../../../domain/project/referenceCuration'
import { readPageUrlOf, researchDesignArgsOf } from './agentToolArgs'
import {
  approveAgentTaskPlanReview,
  markAgentTaskPlanResultsReady,
  normalizeTaskPlanProposal,
  updateAgentTaskPlanStep,
  type AgentTaskPlan,
} from '../../../domain/agent/taskPlan'

import {
  asRecord,
  asStringArray,
  readAssetInfo,
  readGraphSummary,
  readResults,
} from './canvasReadTools'

export {
  AGENT_TOOLS,
  agentToolsForCapabilities,
  agentToolsForRequestMode,
  discoverAgentTools,
  type AgentCapabilityDiscovery,
} from './toolCatalog'

export {
  summarizeGraph,
  readGraphSummary,
  readAssetInfo,
  readResults,
  type GraphSummary,
} from './canvasReadTools'

export {
  planProblems,
  promptlessGenerationProblems,
} from './agentPlanGate'

export interface AgentToolContext {
  store: CanvasStore
  /** 记忆候选的默认目标；Agent 无权改当前项目 / 会话。 */
  memoryContext?: {
    workbench: 'canvas' | 'ecommerce' | 'storyboard'
    projectId: string
    sessionId?: string
  }
  /** 任务计划由会话仓储持有；工具层只经这个端口读写。 */
  taskPlan?: {
    get: () => Promise<AgentTaskPlan | undefined>
    save: (plan: AgentTaskPlan) => Promise<AgentTaskPlan | null>
  }
  /** 新节点的落点（§6：优先视口中心偏左） */
  origin: { x: number; y: number }
  /** 当前可见画布的世界矩形；用于把整组新节点居中。 */
  viewportWorld?: Rect
  /** 跑节点 —— 由执行层注入：agent 自己不直接发渠道请求 */
  runNodes: (
    nodeIds: string[],
    signal?: AbortSignal,
  ) => Promise<AgentRunOutcome[]>
  /** Agent 回合取消信号；确认后执行的付费/写操作也必须跟随停止。 */
  signal?: AbortSignal
  /** 把本轮 applyPlan 产生的 localId 别名解析成真实节点 id（确定性兜底） */
  resolveNodeIds?: (nodeIds: readonly string[]) => string[]
  /** 当前选中的节点 —— `readGraph` 的 `selection` 范围要用；不给就按全图算 */
  selectedIds?: () => readonly string[]
  /**
   * 用户这次是不是「多张图各自一条流程」（见 `expectsPerImageFlows`）。
   *
   * 用户 2026-10-06 第七批 #183：「明明是单独的两个需求他给我替换成了一个需求」。
   * 提示词里已经写了硬约束，这里再做一道**确定性检查** —— 不靠模型自觉。
   */
  perImage?: boolean
  /**
   * 新建节点要补的默认数据（渠道 + 模型 + 生成参数）。
   *
   * 解析默认值要读渠道库（异步），而工具执行器在画布层、拿不到渠道 store，
   * 所以由界面层把「解析」这件事注入进来 —— 解出来的东西**与用户手建节点同源**
   * （两条路都走 `channels.defaultForNewNode`），不会出现「手建的能用、agent 建的
   * 点了没反应」这种分叉。
   *
   * 不给也能跑，但那意味着建出来的生成节点没渠道没模型。
   */
  defaultsForNewNode?: (
    types: readonly AgentNodeType[],
  ) => Promise<Partial<Record<AgentNodeType, Record<string, unknown>>>>
  /**
   * **生成节点该用哪个模型** —— 用户在对话窗上点选的图片 / 视频档
   * （用户 2026-10-03：「我创作面板有什么模型就用什么模型…模型有三个选项」）。
   *
   * 按节点的 `data.mode` 选：视频节点给视频模型，其余给图片模型。
   * 返回 undefined 就保持渠道默认配方不动。
   *
   * 与 `defaultsForNewNode` 一样由界面层注入：工具层认得节点，但不认得渠道 store。
   */
  recipeForGenerated?: (
    type: AgentNodeType,
    node: { data: Record<string, unknown> },
  ) => { channelId: string; model: string } | undefined
  /**
   * 仅在本轮用户明确 @ 了图片 / 视频模型时提供。它必须压过参考图继承的旧模型，
   * 并参与 applyPlan 落前自检。
   */
  explicitRecipeForGenerated?: (
    type: AgentNodeType,
    node: { data: Record<string, unknown> },
  ) => { channelId: string; model: string } | undefined
  /** 当前项目套件里带角色的图片；只写入新建生成节点，供最终生图模型直接读取。 */
  contextAssetsForGenerated?: (
    type: AgentNodeType,
    node: { data: Record<string, unknown> },
  ) => readonly GenerationContextAsset[] | undefined
  /**
   * 逻辑模型 → 能提供它的渠道。`updateNode` 只接受用户点选的模型，
   * 渠道必须和创建面板一样由系统反查，不能让模型自己填。
   */
  channelIdForModel?: (model: string) => string | undefined

  /**
   * **当前画布上选中的节点用的是哪个模型**（按类别；没有选中 / 选中项没有模型时返回空串）。
   *
   * 用户 2026-10-16：「改成跟随选中」。agent 建生成节点时，模型要**优先跟随用户刚选中的
   * 那个节点**，而不是 Agent 面板里那档默认值 —— 真机上用户要香蕉 2、却建成了
   * 清单第一个（GPT Image 2.5），根因就是默认值只能取「列表第一个」。
   */
  selectedModelOf?: (kind: 'image' | 'video') => string

  /**
   * 模型名 → 它是哪一类（`image` / `video` / `chat`）。由界面层注入（那边有渠道目录）。
   *
   * 只为一件事：**生成节点的 `mode` 以模型为准**。真模型（Agnes 2.5 Pro）会把视频节点
   * 写成 `mode: "image"`（它把「生成节点」当默认档），只写对 `model: "Agnes Video 2.0"`；
   * 而执行层是按 `mode` 走图片 / 视频两条链的 —— 不纠正的话，视频模型被塞进生图链路，
   * 点了生成**一个请求都发不出去**（用户 2026-10-03 让我用 agent 做视频时实测到的）。
   */
  categoryOfModel?: (model: string) => 'image' | 'video' | 'chat' | undefined
  /** 像素级裁剪 / 提取选区；由画布宿主注入，工具层不碰 AssetPort 与 Canvas。 */
  sliceImage?: (
    nodeId: string,
    mode: 'extract' | 'crop',
    rect: { x: number; y: number; w: number; h: number },
    ratio?: string,
  ) => Promise<{ ok: boolean; nodeId?: string; reason?: string }>
  /** 宫格切分；由画布宿主注入。 */
  splitGrid?: (
    nodeId: string,
    rows: number,
    cols: number,
  ) => Promise<{ ok: boolean; nodeIds?: string[]; reason?: string }>
  rememberMemory?: (
    candidate: MemoryCandidate,
  ) => Promise<{ ok: boolean; memoryId?: string; text?: string; reason?: string }>
  /** 只读视觉验收；由界面层注入真实视觉模型与素材读取能力。 */
  visualReview?: (input: {
    nodeIds: readonly string[]
    checklist?: string
  }) => Promise<VisualReviewResult>
  /**
   * 节点当前运行状态；由执行宿主注入。`readResult` 用它区分“从没跑过”
   * 与“跑过但失败”，并把已知失败原因还给模型。
   */
  nodeRunStateOf?: (
    nodeId: string,
  ) => { kind: 'failed'; error?: AppError; reason?: string } | undefined
  /** 设计调研；由界面层注入网络与灵感库读取能力。 */
  researchDesign?: (input: {
    topic: string
    queries?: readonly string[]
    urls?: readonly string[]
    maxResults?: number
  }) => Promise<unknown>
  /** 读公开网页正文（Jina Reader）；由界面层注入网络与联网开关。 */
  readPage?: (input: { url: string }) => Promise<unknown>
  /** 真实参考分析；由界面层注入视觉模型、台账和素材读取能力。 */
  curateReferences?: (input: {
    task: string
    itemIds?: readonly string[]
  }) => Promise<ReferenceCurationResult>
}

/**
 * `runFrom` 的节点集合：起点 + 沿连线可达的下游。
 *
 * 两个刻意的边界：
 * - **提示词节点不是可执行项**（它没有 `toRunRequest`），只作为链路中的输入；
 * - **批量 / 循环不在这里展开**。它们各自的 `runNode` 已经会按自己的分发语义跑下游，
 *   若再被这里当作普通节点扫一遍，会产生重复执行。遇到就如实拒绝，让模型改用
 *   `runNode` 直接触发那个分发器。
 */
export function runFromNodeIds(
  store: Pick<CanvasStore, 'getSnapshot'>,
  nodeIds: unknown,
): { ok: true; ids: string[] } | { ok: false; problems: string[] } {
  const graph = store.getSnapshot()
  const starts = asStringArray(nodeIds)
  if (starts.length === 0) return { ok: false, problems: ['runFrom 缺少起点节点'] }

  const reachable = new Set<string>()
  for (const start of starts) {
    if (!graph.nodes.some((n) => n.id === start)) {
      return { ok: false, problems: [`找不到起点节点：${start}`] }
    }
    reachable.add(start)
    for (const id of downstreamOf(start, graph.edges)) reachable.add(id)
  }

  const nodes = graph.nodes.filter((n) => reachable.has(n.id))
  const dispatchers = nodes.filter((n) => n.type === 'batch' || n.type === 'loop')
  if (dispatchers.length > 0) {
    return {
      ok: false,
      problems: [
        `下游链里有分发器节点（${dispatchers.map((n) => n.title || n.id).join('、')}），请直接对分发器运行 runNode`,
      ],
    }
  }

  const disabled = nodes.filter((n) => n.disabled && canBuildRequest(n))
  if (disabled.length > 0) {
    return {
      ok: false,
      problems: [
        `下游链里有已禁用节点（${disabled.map((n) => n.title || n.id).join('、')}），先启用或移除它`,
      ],
    }
  }

  const ids = nodes.filter(canBuildRequest).map((n) => n.id)
  if (ids.length === 0) return { ok: false, problems: ['这条下游链里没有可运行的节点'] }
  return { ok: true, ids }
}

/** 读类执行器：循环里直接调（设计文档 §4） */
export async function executeReadTool(
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const a = asRecord(args)
  switch (name) {
    case 'readCapabilities':
      return discoverAgentTools(
        typeof a.query === 'string' ? a.query : '',
      ).result
    case 'readGraph':
      return readGraphSummary(ctx.store, a.scope, ctx.selectedIds?.() ?? [])
    case 'readAsset':
      return { assets: readAssetInfo(ctx.store, a.nodeIds) }
    case 'curateReferences': {
      const task = typeof a.task === 'string' ? a.task.trim() : ''
      if (!task) return { ok: false, error: '参考分析缺少 task' }
      if (!ctx.curateReferences) {
        return { ok: false, error: '当前会话没有接入参考分析服务' }
      }
      const itemIds = asStringArray(a.itemIds)
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 12)
      return ctx.curateReferences({
        task,
        ...(itemIds.length > 0 ? { itemIds } : {}),
      })
    }
    case 'readResult':
      return { results: readResults(ctx.store, a.nodeIds, ctx.nodeRunStateOf) }
    case 'researchDesign': {
      const input = researchDesignArgsOf(a)
      if (!input) return { ok: false, error: '设计调研缺少 topic' }
      if (!ctx.researchDesign) return { ok: false, error: '当前会话没有接入设计调研服务' }
      return ctx.researchDesign(input)
    }
    case 'readPage': {
      const url = readPageUrlOf(a)
      if (!url) return { ok: false, error: 'readPage 需要一个 http / https 网址' }
      if (!ctx.readPage) return { ok: false, error: '当前会话没有接入网页读取服务' }
      return ctx.readPage({ url })
    }
    case 'visualReview': {
      const rawIds = asStringArray(a.nodeIds)
      const nodeIds = ctx.resolveNodeIds ? ctx.resolveNodeIds(rawIds) : rawIds
      if (!ctx.visualReview) {
        return {
          ok: false,
          verdict: 'unreviewable',
          summary: '当前会话没有接入视觉验收子代理',
          issues: [],
          targetNodeIds: nodeIds,
          limitations: ['缺少视觉模型或素材读取能力'],
        }
      }
      return ctx.visualReview({
        nodeIds,
        ...(typeof a.checklist === 'string' && a.checklist.trim()
          ? { checklist: a.checklist.trim() }
          : {}),
      })
    }
    default:
      return { ok: false, error: `没有这个读类工具：${name}` }
  }
}

/**
 * 写 / 花钱的执行器：**只应由界面的「确认」按钮调用**（设计文档 §9）。
 *
 * 与读类分开导出，是为了让「循环里偷偷写」在代码结构上就写不出来。
 */

function expectedModelCategoryOfNode(
  node: { type: string; data: unknown },
): 'image' | 'video' | 'chat' | undefined {
  if (node.type === 'prompt') return 'chat'
  if (node.type !== 'generation' && node.type !== 'batch') return undefined
  return asRecord(node.data).mode === 'video' ? 'video' : 'image'
}


async function markCurrentPlanResultsReady(
  ctx: AgentToolContext,
  plan: AgentTaskPlan | undefined,
): Promise<AgentTaskPlan | undefined> {
  if (!ctx.taskPlan || !plan) return undefined
  const marked = markAgentTaskPlanResultsReady(plan, Date.now())
  if (!marked.ok) return undefined
  return (await ctx.taskPlan.save(marked.plan)) ?? undefined
}

export async function executeConfirmedTool(
  name: string,
  args: unknown,
  ctx: AgentToolContext,
): Promise<unknown> {
  const a = asRecord(args)
  const activePlan = ctx.taskPlan ? await ctx.taskPlan.get() : undefined
  const activeStep =
    activePlan?.steps.find((step) => step.id === activePlan.currentStepId) ??
    activePlan?.steps.find((step) => step.status === 'in_progress')
  if (
    activeStep?.resultsReadyAt &&
    !activeStep.reviewApprovedAt &&
    (name === 'applyPlan' || name === 'runNode' || name === 'runFrom')
  ) {
    return {
      ok: false,
      problems: [
        `当前步骤「${activeStep.title}」已有结果，正在等用户验收。`,
        '先调用 requestTaskConfirmation（purpose=review）让用户确认；确认前不能新建下一阶段或继续生成。',
      ],
    }
  }
  switch (name) {
    case 'proposeTaskPlan': {
      if (!ctx.taskPlan) {
        return { ok: false, problems: ['当前会话没有接入任务计划存储'] }
      }
      const normalized = normalizeTaskPlanProposal(a, {
        id: createId('taskplan'),
        now: Date.now(),
      })
      if (!normalized.ok) return normalized
      const saved = await ctx.taskPlan.save(normalized.plan)
      return saved
        ? { ok: true, plan: saved }
        : { ok: false, problems: ['任务计划保存失败'] }
    }
    case 'updateTaskStep': {
      if (!ctx.taskPlan) {
        return { ok: false, problems: ['当前会话没有接入任务计划存储'] }
      }
      const current = await ctx.taskPlan.get()
      if (!current) {
        return {
          ok: false,
          problems: ['当前没有已批准的执行计划；复杂任务先调用 proposeTaskPlan'],
        }
      }
      const updated = updateAgentTaskPlanStep(current, a, Date.now())
      if (!updated.ok) return updated
      const saved = await ctx.taskPlan.save(updated.plan)
      return saved
        ? { ok: true, plan: saved }
        : { ok: false, problems: ['任务计划进度保存失败'] }
    }
    case 'requestTaskConfirmation': {
      const question = typeof a.question === 'string' ? a.question.trim() : ''
      if (!question) return { ok: false, problems: ['缺少需要用户确认的问题'] }
      const stepId = typeof a.stepId === 'string' ? a.stepId.trim() : ''
      if (!ctx.taskPlan) {
        return { ok: false, problems: ['当前会话没有接入任务计划存储'] }
      }
      if (!stepId) {
        return { ok: false, problems: ['阶段确认必须绑定当前计划的 stepId'] }
      }
      const current = await ctx.taskPlan.get()
      if (!current) {
        return { ok: false, problems: ['当前没有已批准的执行计划'] }
      }
      const step = current.steps.find((item) => item.id === stepId)
      if (!step) {
        return { ok: false, problems: [`找不到计划步骤：${stepId}`] }
      }
      const purpose = a.purpose === 'review' ? 'review' : 'clarification'
      if (purpose === 'review') {
        const approved = approveAgentTaskPlanReview(current, stepId, Date.now())
        if (!approved.ok) return approved
        const saved = await ctx.taskPlan.save(approved.plan)
        if (!saved) return { ok: false, problems: ['任务步骤验收状态保存失败'] }
        return {
          ok: true,
          approved: true,
          purpose,
          question,
          stepId,
          plan: saved,
          message: '用户已验收当前步骤结果，可以继续。',
        }
      }
      return {
        ok: true,
        approved: true,
        purpose,
        question,
        stepId,
        message: '用户已确认，可以继续执行当前计划步骤。',
      }
    }
    case 'applyPlan': {
      const existing = ctx.store.getSnapshot().nodes.map((n) => ({
        id: n.id,
        type: n.type,
      }))
      const { problems, plan } = planProblems(a, existing)
      if (!plan) return { ok: false, problems }
      /**
       * **「每张图各自一条流程」的确定性检查**（用户 2026-10-06 第七批 #183）。
       *
       * 提示词里已经写了硬约束，但真机上模型照样把两张图并成一条 —— 于是两个需求被办成一个。
       * 这一条不靠它自觉：用户 @ 了多张图、又没说「合成」时，**生成节点数少于图数**
       * 就把计划退回给模型重做（`problems` 会回填给它，下一轮它会按这个改）。
       */
      if (ctx.perImage) {
        const graph = ctx.store.getSnapshot()
        const attachedIds = new Set((plan.attach ?? []).map((at) => at.localId))
        const attachedImages = (plan.attach ?? []).filter((at) => {
          const n = graph.nodes.find((x) => x.id === at.existingNodeId)
          return Boolean((n?.data as { assetHash?: string } | undefined)?.assetHash)
        }).length
        const newGenerations = plan.nodes.filter(
          (n) => n.type === 'generation' && !attachedIds.has(n.localId),
        ).length
        if (attachedImages >= 2 && newGenerations < attachedImages) {
          return {
            ok: false,
            problems: [
              `用户要的是每张图各自处理，但这份计划只建了 ${newGenerations} 个生成节点、@ 了 ${attachedImages} 张图。`,
              '请**一张图配一个生成节点**：各自 attach、各自在 edges 里连线，不要并成一条流程。',
            ],
          }
        }
      }
      /**
       * 生成节点的 `mode` **以模型自己的类别为准**（详见 `alignGenerationMode`）：
       * 真模型常把视频节点写成 `mode:"image"`，不纠正的话请求都组不出来。
       */
      const aligned = ctx.categoryOfModel
        ? alignGenerationMode(plan, ctx.categoryOfModel)
        : { plan, notes: [] }
      const finalPlan = aligned.plan
      /**
       * 先把「新建节点的默认数据」解出来，再交给纯函数建命令。
       *
       * 只解**计划里真用到的类型**：一次对话可能只建生成节点，没必要去问聊天模型。
       * 复用（attach）的节点不新建，也就不需要默认值。
       */
      const needed = [...new Set(finalPlan.nodes.map((n) => n.type))]
      const defaults = ctx.defaultsForNewNode ? await ctx.defaultsForNewNode(needed) : undefined
      const applied = applyAgentPlan(ctx.store, finalPlan, ctx.origin, {
        /**
         * 三层打底由 `buildLandingCommand` 负责，这里只把**用户点选的那一档**
         * 叠进「渠道默认配方」这一层：计划里自己写了模型仍然以计划为准（§11）。
         */
        dataFor: (type: AgentNodeType, node) => {
          const base = defaults?.[type] ?? {}
          const picked = ctx.recipeForGenerated?.(type, node)
          return picked ? { ...base, channelId: picked.channelId, model: picked.model } : base
        },
        ...(ctx.explicitRecipeForGenerated
          ? {
              explicitFor: (type: AgentNodeType, node: AgentPlan['nodes'][number]) => {
                const picked = ctx.explicitRecipeForGenerated?.(type, node)
                return picked ? { channelId: picked.channelId, model: picked.model } : {}
              },
            }
          : {}),
        ...(ctx.contextAssetsForGenerated
          ? {
              contextAssetsFor: (type: AgentNodeType, node: AgentPlan['nodes'][number]) =>
                ctx.contextAssetsForGenerated?.(type, node),
            }
          : {}),
        ...(ctx.viewportWorld ? { viewportWorld: ctx.viewportWorld } : {}),
      })
      const attachedLocalIds = new Set((finalPlan.attach ?? []).map((item) => item.localId))
      const landingProblems = finalPlan.nodes.flatMap((node) => {
        if (node.type !== 'generation' || attachedLocalIds.has(node.localId)) return []
        const expected = ctx.explicitRecipeForGenerated?.(node.type, node)
        const resolved = applied.resolvedNodes.find((item) => item.localId === node.localId)
        const actualData = resolved
          ? (ctx.store.getSnapshot().nodes.find((item) => item.id === resolved.nodeId)?.data as
              | { model?: unknown; mode?: unknown }
              | undefined)
          : undefined
        const actualModel = actualData?.model
        const problems: string[] = []
        if (
          typeof actualModel === 'string' &&
          ctx.categoryOfModel?.(actualModel) === 'chat'
        ) {
          problems.push(
            `节点「${node.title ?? node.localId}」是生成节点，却写入了对话模型 ${actualModel}。`,
          )
        }
        if (
          expected &&
          !(
            typeof actualModel === 'string' &&
            actualModel === expected.model
          )
        ) {
          problems.push(
              `节点「${node.title ?? node.localId}」明确要求使用 ${expected.model}，` +
                `实际写入的是 ${typeof actualModel === 'string' && actualModel ? actualModel : '(空)'}。`,
          )
        }
        return problems
      })
      /**
       * 落地成功不等于已经安全：外层工具账本马上会把结果记成 finished。
       * 必须在它之前等画布持久化屏障，否则进程崩溃后会出现“账本成功、画布丢失”。
       */
      await ctx.store.flush()
      // 自检结果整份回填：模型要靠它决定补连线还是改图（§6.1）
      return {
        ok: applied.ok && landingProblems.length === 0,
        problems: [...applied.problems, ...landingProblems],
        createdNodeIds: applied.createdNodeIds,
        resolvedNodes: applied.resolvedNodes,
        ...(aligned.notes.length > 0 ? { notes: aligned.notes } : {}),
      }
    }
    case 'updateNode': {
      /**
       * **批量改：一次确认**（用户 2026-10-06 第七批 #187）。
       *
       * 用户原话：「我说八张都改模型的时候还需要我一个一个的确认，这不符合逻辑，
       * 这种改动应该一次性让我确认即可」。原来只收单个 `nodeId`，模型只能一次改一个 ——
       * 真机截图里「八张都改刚刚的那个模型」后面跟了 **7 次**「已改节点参数」和 7 次确认。
       *
       * 现在补上 `nodeIds`（复数）：同一个 patch **一次改完整批**，确认卡也只弹一次。
       * 一次意图 = 一次确认。
       */
      const ids = [
        ...new Set([
          ...asStringArray(a.nodeIds),
          ...(typeof a.nodeId === 'string' && a.nodeId ? [a.nodeId] : []),
        ]),
      ]
      if (ids.length === 0) return { ok: false, problems: ['没有指定要改的节点'] }
      const graph = ctx.store.getSnapshot()
      const missing = ids.filter((id) => !graph.nodes.some((n) => n.id === id))
      if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
      /**
       * `channelId` 是内部实现，Agent 无权直接指定。先剥掉，再由模型反查补回。
       * 这样模型即使把某个内置渠道 id 写进 patch，也不会改变真实路由。
       */
      const patch = { ...asRecord(a.data) }
      delete patch.channelId
      const requestedModel =
        typeof patch.model === 'string' ? patch.model.trim() : undefined
      const requestedCategory = requestedModel
        ? ctx.categoryOfModel?.(requestedModel)
        : undefined
      if (requestedCategory) {
        const targets = graph.nodes.filter((node) => ids.includes(node.id))
        const incompatible = targets.filter((node) => {
          const expected = expectedModelCategoryOfNode(node)
          return expected !== undefined && expected !== requestedCategory
        })
        if (incompatible.length > 0) {
          return {
            ok: false,
            problems: [
              `模型「${requestedModel}」属于 ${requestedCategory} 类别，不能写到这些节点：` +
                incompatible
                  .map((node) => {
                    const expected = expectedModelCategoryOfNode(node)
                    return `「${node.title ?? node.id}」需要 ${expected} 模型`
                  })
                  .join('、'),
            ],
          }
        }
      }
      const routedPatch =
        requestedModel === undefined
          ? patch
          : requestedModel
            ? (() => {
                const channelId = ctx.channelIdForModel?.(requestedModel)
                return channelId
                  ? { ...patch, model: requestedModel, channelId }
                  : null
              })()
            : { ...patch, model: '' }
      if (routedPatch === null) {
        return {
          ok: false,
          problems: [`没有可用渠道提供模型「${requestedModel}」，请先在后台勾选并配置映射`],
        }
      }
      /**
       * ★★ **出过图的节点，正文是历史记录，不许覆盖**（用户 2026-10-05 第五批第 4 条：
       * 「agent 提出的需求应该先新建节点，然后把提示词放在新建节点上，而不是把提示词覆盖
       * 原有的节点，这样才会有原本的记录，否则第一个图片的提示词直接被覆盖了」）。
       *
       * 这是**确定性拦截**，不靠提示词自觉：真机上模型就是走了 `updateNode` 把
       * 「小猫钓鱼」那句提示词整句换成了「小狗钓鱼」，用户回头再也看不到上一版写了什么。
       * 拦下来之后把「该怎么做」一并告诉它（循环会把 problems 回填给模型），
       * 它下一轮就会改成「新建节点 + attach 旧图」。
       *
       * 只拦**正文**（`prompt` / `text`）：比例 / 张数 / 模型这些参数本来就是我们让
       * 用户随时改的（用户也确实会点名要改）。
       *
       * 批量时**一个不合格就整批不动**：改一半比不改更难收拾。
       */
      const touchesText = 'prompt' in routedPatch || 'text' in routedPatch
      if (touchesText) {
        const blocked = graph.nodes.filter(
          (n) => ids.includes(n.id) && Boolean((n.data as { assetHash?: unknown }).assetHash),
        )
        if (blocked.length > 0) {
          return {
            ok: false,
            problems: [
              `这些节点已经出过图，正文是上一版的记录，不能覆盖：${blocked
                .map((n) => `「${n.title ?? n.id}」`)
                .join('、')}`,
              '要改就**新建生成节点**、用 attach 把它们接成上游，把新提示词写在新节点上，再 runNode 跑新节点。',
            ],
          }
        }
      }
      for (const id of ids) ctx.store.dispatch({ kind: 'node.updateData', id, patch: routedPatch })
      await ctx.store.flush()
      return { ok: true }
    }
    case 'runNode': {
      const rawIds = asStringArray(a.nodeIds)
      const ids = ctx.resolveNodeIds ? ctx.resolveNodeIds(rawIds) : rawIds
      if (ids.length === 0) return { ok: false, problems: ['没有指定要跑的节点'] }
      const outcomes = await ctx.runNodes(ids, ctx.signal)
      const savedPlan = outcomes.some((outcome) => outcome.ok)
        ? await markCurrentPlanResultsReady(ctx, activePlan)
        : undefined
      return {
        ok: outcomes.every((o) => o.ok),
        outcomes,
        ...(savedPlan ? { plan: savedPlan } : {}),
      }
    }
    case 'runFrom': {
      const rawIds = asStringArray(a.nodeIds)
      const ids = ctx.resolveNodeIds ? ctx.resolveNodeIds(rawIds) : rawIds
      const resolved = runFromNodeIds(ctx.store, ids)
      if (!resolved.ok) return resolved
      const outcomes = await ctx.runNodes(resolved.ids, ctx.signal)
      const savedPlan = outcomes.some((outcome) => outcome.ok)
        ? await markCurrentPlanResultsReady(ctx, activePlan)
        : undefined
      return {
        ok: outcomes.every((o) => o.ok),
        outcomes,
        ...(savedPlan ? { plan: savedPlan } : {}),
      }
    }
    case 'rememberMemory': {
      if (!ctx.rememberMemory) {
        return { ok: false, reason: '当前会话没有接入个人记忆存储' }
      }
      const candidate = normalizeMemoryCandidate(a, {
        ...(ctx.memoryContext?.workbench
          ? { workbench: ctx.memoryContext.workbench }
          : {}),
        ...(ctx.memoryContext?.projectId
          ? { projectId: ctx.memoryContext.projectId }
          : {}),
        ...(ctx.memoryContext?.sessionId
          ? { sessionId: ctx.memoryContext.sessionId }
          : {}),
      })
      const problems = memoryCandidateProblems(candidate)
      if (problems.length > 0) return { ok: false, reason: problems.join('；') }
      return ctx.rememberMemory(candidate)
    }
    case 'moveNodes':
      return moveNodesInStore(ctx.store, a)
    case 'arrangeNodes':
      return arrangeNodesInStore(ctx.store, a)
    case 'resizeNodes':
      return resizeNodesInStore(ctx.store, a)
    case 'deleteNodes':
      return deleteNodesInStore(ctx.store, a)
    case 'deleteEdges':
      return deleteEdgesInStore(ctx.store, a)
    case 'compareNodes':
      return compareNodesInStore(ctx.store, a)
    case 'sliceImage': {
      const nodeId = typeof a.nodeId === 'string' ? a.nodeId : ''
      const mode = a.mode === 'crop' ? 'crop' : a.mode === 'extract' ? 'extract' : null
      if (!nodeId || !mode) return { ok: false, problems: ['需要 nodeId 与 extract / crop 模式'] }
      const node = ctx.store.getSnapshot().nodes.find((item) => item.id === nodeId)
      if (!node) return { ok: false, problems: ['节点不存在'] }
      if (!(node.data as { assetHash?: unknown }).assetHash) {
        return { ok: false, problems: ['这个节点还没有图片'] }
      }
      const rect = asRecord(a.rect)
      const x = Number(rect.x)
      const y = Number(rect.y)
      const w = Number(rect.w)
      const h = Number(rect.h)
      if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
        if (!ctx.sliceImage) return { ok: false, problems: ['当前画布没有接入裁剪能力'] }
        const result = await ctx.sliceImage(
          nodeId,
          mode,
          { x, y, w, h },
          typeof a.ratio === 'string' ? a.ratio : undefined,
        )
        if (result.ok && result.nodeId) {
          const created = ctx.store.getSnapshot().nodes.find((item) => item.id === result.nodeId)
          if (created) placeNodeWithoutOverlap(ctx.store, created.id, created)
          await ctx.store.flush()
        }
        return result
      }
      ctx.store.openCropLightbox(nodeId, { plain: mode === 'crop' })
      return {
        ok: true,
        waitingForSelection: true,
        message: `已在灯箱打开「${mode === 'crop' ? '裁剪' : '提取选区'}」，请在图上框选后确认`,
      }
    }
    case 'splitGrid': {
      const nodeId = typeof a.nodeId === 'string' ? a.nodeId : ''
      const rows = Math.floor(Number(a.rows))
      const cols = Math.floor(Number(a.cols))
      if (
        !nodeId ||
        !Number.isFinite(rows) ||
        !Number.isFinite(cols) ||
        rows < 1 ||
        cols < 1 ||
        rows > 64 ||
        cols > 64
      ) {
        return { ok: false, problems: ['需要 nodeId、rows 与 cols，且行列数必须在 1–64'] }
      }
      if (!ctx.splitGrid) return { ok: false, problems: ['当前画布没有接入宫格切分能力'] }
      const result = await ctx.splitGrid(nodeId, rows, cols)
      if (result.ok && result.nodeIds?.length) {
        for (const id of result.nodeIds) {
          const created = ctx.store.getSnapshot().nodes.find((item) => item.id === id)
          if (created) placeNodeWithoutOverlap(ctx.store, created.id, created)
        }
        await ctx.store.flush()
      }
      return result
    }
    default:
      return { ok: false, problems: [`没有这个工具：${name}`] }
  }
}
