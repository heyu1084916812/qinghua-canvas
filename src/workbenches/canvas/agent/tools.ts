import {
  alignGenerationMode,
  normalizeAgentPlan,
  validateAgentPlan,
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
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { createId } from '../../../shared/id'
import {
  avoidRectOverlap,
  isTopLevelNode,
  nodeMinSize,
  placeNodeWithoutOverlap,
  snapshotRects,
} from './agentGeometry'
import {
  memoryCandidateProblems,
  normalizeMemoryCandidate,
  type MemoryCandidate,
} from '../../../domain/shared/memoryOrganizer'
import type { VisualReviewResult } from '../../../domain/agent/visualReview'
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
    urls?: readonly string[]
    maxResults?: number
  }) => Promise<unknown>
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
  store: CanvasStore,
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
    case 'readResult':
      return { results: readResults(ctx.store, a.nodeIds, ctx.nodeRunStateOf) }
    case 'researchDesign': {
      const topic = typeof a.topic === 'string' ? a.topic.trim() : ''
      if (!topic) return { ok: false, error: '设计调研缺少 topic' }
      if (!ctx.researchDesign) {
        return { ok: false, error: '当前会话没有接入设计调研服务' }
      }
      const urls = asStringArray(a.urls)
        .map((url) => url.trim())
        .filter((url) => /^https?:\/\//i.test(url))
        .slice(0, 8)
      const maxResults =
        typeof a.maxResults === 'number' && Number.isFinite(a.maxResults)
          ? Math.min(24, Math.max(1, Math.round(a.maxResults)))
          : undefined
      return ctx.researchDesign({
        topic,
        ...(urls.length > 0 ? { urls } : {}),
        ...(maxResults ? { maxResults } : {}),
      })
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
/**
 * `applyPlan` 的**落前检查**：先归一化、再校验，返回问题列表（空 = 可以落地）。
 *
 * 这是「计划 → 画布」的唯一关口，两个用处：
 * ① 落地前把**形状差异**补齐（`normalizeAgentPlan`），别因为 `order` 写成字符串
 *    这种事整份拒绝；
 * ② 真推不出来的（不认识类型 / 连线指向不存在）整份拒绝，并把问题回给模型。
 *
 * 用户 2026-10-02 报的「重复让我确认新建工作流、重复了三次、画布上什么都没有」
 * 就出在这一步：当时建图还排在确认卡后面，用户先点一次确认我们才发现计划不合法。
 * 现在**建图根本不问**（见 `agentLoop` 的 `WRITE_TOOLS`），失败也直接以
 * 步骤卡的形式露在对话里。
 */
function disambiguateAttachAliases(raw: unknown): unknown {
  const row = asRecord(raw)
  if (!Array.isArray(row.nodes) || !Array.isArray(row.attach) || row.attach.length === 0) {
    return raw
  }
  const nodes = row.nodes.map(asRecord)
  const rawEdges = (Array.isArray(row.edges) ? row.edges : []).map(asRecord)
  const nodeByLocalId = new Map(
    nodes.flatMap((node) =>
      typeof node.localId === 'string' && node.localId
        ? [[node.localId, node] as const]
        : [],
    ),
  )
  const usedLocalIds = new Set(nodeByLocalId.keys())
  const aliasOf = new Map<string, string>()
  const extraNodes: Record<string, unknown>[] = []
  const attach = row.attach.map((item, index) => {
    const entry = asRecord(item)
    const localId = typeof entry.localId === 'string' ? entry.localId : ''
    const node = nodeByLocalId.get(localId)
    const data = asRecord(node?.data)
    const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : ''
    const usedAsUpstream = rawEdges.some((edge) => edge.source === localId)
    const collidesWithNewGeneration =
      Boolean(node) &&
      node?.type === 'generation' &&
      Boolean(prompt) &&
      !usedAsUpstream
    if (!collidesWithNewGeneration) return entry

    let referenceId = `${localId}__reference`
    while (usedLocalIds.has(referenceId)) referenceId += '_'
    usedLocalIds.add(referenceId)
    aliasOf.set(localId, referenceId)
    extraNodes.push({
      localId: referenceId,
      type: node?.type,
      title: '参考图',
      data: {},
      order: typeof node?.order === 'number' ? node.order : index,
    })
    return { ...entry, localId: referenceId }
  })
  if (extraNodes.length === 0) return raw

  const edges = (Array.isArray(row.edges) ? row.edges : []).map((item) => {
    const edge = asRecord(item)
    return {
      ...edge,
      ...(typeof edge.source === 'string' && aliasOf.has(edge.source)
        ? { source: aliasOf.get(edge.source)! }
        : {}),
      ...(typeof edge.target === 'string' && aliasOf.has(edge.target)
        ? { target: aliasOf.get(edge.target)! }
        : {}),
    }
  })
  for (const [target, referenceId] of aliasOf) {
    if (!edges.some((edge) => edge.source === referenceId && edge.target === target)) {
      edges.push({ source: referenceId, target })
    }
  }
  return { ...row, nodes: [...row.nodes, ...extraNodes], edges, attach }
}

export function planProblems(
  args: unknown,
  existingNodeIds: readonly string[],
): { problems: string[]; plan: AgentPlan | null } {
  const { plan } = normalizeAgentPlan(disambiguateAttachAliases(args))
  const checked = validateAgentPlan(plan, existingNodeIds)
  if (!checked.ok) return { problems: checked.errors, plan: null }
  const attachedLocalIds = new Set((checked.plan.attach ?? []).map((item) => item.localId))
  if (checked.plan.nodes.every((node) => attachedLocalIds.has(node.localId))) {
    return {
      problems: [
        '这份计划只复用了画布上已有的节点，没有任何要新建的节点。',
        '如果要在 @ 的图片基础上继续设计，请至少新建一个生成节点，并把节点 id 放进 attach 对应到现有图片；不要提交一份只有 attach 的空计划。',
      ],
      plan: null,
    }
  }
  /**
   * 过形状这一关之后再看一眼**内容**：有没有节点按定义就永远跑不起来。
   *
   * 用户 2026-10-04 报的正是这一类：「结构全对，但是没有提示词」—— 计划能落地、
   * 看着像模像样，可是下游生成节点一个提示词都拿不到（`toRunRequest` 直接返回 null）。
   * 落地之后再让用户自己发现，比当场把话还给模型糟得多。
   */
  const promptless = promptlessGenerationProblems(checked.plan)
  return promptless.length > 0
    ? { problems: promptless, plan: null }
    : { problems: [], plan: checked.plan }
}

/**
 * 上游能**给文字**的节点类型（与 `generationSpec.collectInputs` 同口径）：
 * 提示词节点给 `data.text`，循环节点每轮给 `__roundPrompt`，生成 / 批量 / 分组
 * 自身也可能带着正文。判不出来的（attach 过来的既有节点）一律**当它能给**，
 * 宁可放过、也不要冤枉一份正常计划。
 */
const TEXT_SOURCE_TYPES = new Set<AgentNodeType>(['prompt', 'loop', 'group', 'batch', 'generation'])

/**
 * 找「**永远跑不起来**的生成节点」：自己没有正文，上游也没有一个能给文字的节点。
 *
 * 为什么值得当场拦：`generationSpec.toRunRequest` 在提示词为空时直接返回 null，
 * 也就是这个节点点多少次都不会发请求 —— 不拦的话用户只会看到一张建好的、跑不动的图。
 */
export function promptlessGenerationProblems(plan: AgentPlan): string[] {
  const byId = new Map(plan.nodes.map((n) => [n.localId, n]))
  const attached = new Set((plan.attach ?? []).map((a) => a.localId))
  const out: string[] = []
  for (const [i, node] of plan.nodes.entries()) {
    if (node.type !== 'generation') continue
    /**
     * **被 attach 的节点不用有提示词**：它本来就在画布上（是复用，不是新建），
     * 这条检查管的是「这次**要建**的生成节点跑不跑得起来」。
     * 以前没跳过：模型按规矩把既有图写成 attach 后，反而被这条判成「没有提示词」而整份退回
     * （2026-10-06 第七批 #183 的排查里撞上）。
     */
    if (attached.has(node.localId)) continue
    const own = node.data.prompt
    if (typeof own === 'string' && own.trim()) continue
    const upstream = plan.edges
      .filter((e) => e.target === node.localId)
      .map((e) => byId.get(e.source))
    const hasTextSource = upstream.some(
      (u) => u && (attached.has(u.localId) || TEXT_SOURCE_TYPES.has(u.type)),
    )
    if (hasTextSource) continue
    out.push(
      `第 ${i + 1} 个节点（generation「${node.title ?? node.localId}」）既没有自己的提示词，` +
        '上游也没有能给它文字的节点 —— 这条链永远跑不出图。' +
        '把用户要的画面写进它的 data.prompt，或建一个提示词节点（正文写在 data.text）连到它。',
    )
  }
  return out
}

function expectedModelCategoryOfNode(
  node: { type: string; data: unknown },
): 'image' | 'video' | 'chat' | undefined {
  if (node.type === 'prompt') return 'chat'
  if (node.type !== 'generation' && node.type !== 'batch') return undefined
  return asRecord(node.data).mode === 'video' ? 'video' : 'image'
}

function selectedNodes(store: CanvasStore, ids: readonly string[]) {
  const graph = store.getSnapshot()
  const unique = [...new Set(ids)]
  const nodes = unique.map((id) => graph.nodes.find((node) => node.id === id))
  const missing = unique.filter((_, index) => !nodes[index])
  return {
    unique,
    nodes: nodes.filter((node): node is NonNullable<typeof node> => !!node),
    missing,
  }
}

async function moveNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要移动的节点'] }
  const { unique, nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点的位置与尺寸由容器管理，请把节点移出组后再操作'] }
  }

  const positionRows = Array.isArray(args.positions) ? args.positions.map(asRecord) : []
  const positions = new Map(
    positionRows.flatMap((row) => {
      const nodeId = typeof row.nodeId === 'string' ? row.nodeId : ''
      const x = Number(row.x)
      const y = Number(row.y)
      return nodeId && Number.isFinite(x) && Number.isFinite(y)
        ? [[nodeId, { x, y }] as const]
        : []
    }),
  )
  const dx = Number.isFinite(Number(args.dx)) ? Number(args.dx) : 0
  const dy = Number.isFinite(Number(args.dy)) ? Number(args.dy) : 0
  if (positions.size === 0 && dx === 0 && dy === 0) {
    return { ok: false, problems: ['请提供 positions，或非零的 dx / dy'] }
  }
  if (positions.size > 0 && unique.some((id) => !positions.has(id))) {
    return { ok: false, problems: ['positions 必须覆盖 nodeIds 里的每一个节点'] }
  }

  store.beginPlan(`agent-move:${createId('plan')}`, 'Agent 移动节点')
  for (const node of nodes) placeNodeWithoutOverlap(store, node.id, {
    x: node.x + (positions.get(node.id) ? positions.get(node.id)!.x - node.x : dx),
    y: node.y + (positions.get(node.id) ? positions.get(node.id)!.y - node.y : dy),
    w: node.w,
    h: node.h,
  })
  store.endPlan()
  await store.flush()
  const after = store.getSnapshot().nodes
  return {
    ok: true,
    moved: nodes.map((node) => {
      const latest = after.find((item) => item.id === node.id) ?? node
      return { nodeId: node.id, x: Math.round(latest.x), y: Math.round(latest.y) }
    }),
  }
}

async function arrangeNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length < 2) return { ok: false, problems: ['至少需要 2 个节点才能排列'] }
  const { unique, nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点由容器自动排版，不需要再排列'] }
  }
  const parents = new Set(nodes.map((node) => node.parentId ?? null))
  if (parents.size > 1) {
    return { ok: false, problems: ['一次只能排列同一层级的节点，不能混排分组内外的节点'] }
  }
  const layout = String(args.layout ?? '')
  if (!['horizontal', 'vertical', 'grid'].includes(layout)) {
    return { ok: false, problems: ['layout 只能是 horizontal / vertical / grid'] }
  }
  const gapRaw = Number(args.gap)
  const gap = Number.isFinite(gapRaw) ? Math.min(240, Math.max(8, gapRaw)) : 32
  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)
  const left = Math.min(...ordered.map((node) => node.x))
  const top = Math.min(...ordered.map((node) => node.y))
  const targets = new Map<string, { x: number; y: number }>()

  if (layout === 'horizontal') {
    let cursor = left
    for (const node of ordered) {
      targets.set(node.id, { x: cursor, y: top })
      cursor += node.w + gap
    }
  } else if (layout === 'vertical') {
    let cursor = top
    for (const node of ordered) {
      targets.set(node.id, { x: left, y: cursor })
      cursor += node.h + gap
    }
  } else {
    const columnsRaw = Number(args.columns)
    const columns = Number.isFinite(columnsRaw)
      ? Math.min(ordered.length, Math.max(1, Math.floor(columnsRaw)))
      : Math.min(ordered.length, Math.ceil(Math.sqrt(ordered.length)))
    const rows = Math.ceil(ordered.length / columns)
    const colWidths = Array.from({ length: columns }, (_, col) =>
      Math.max(...ordered.filter((_, index) => index % columns === col).map((node) => node.w)),
    )
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(
        ...ordered
          .slice(row * columns, (row + 1) * columns)
          .map((node) => node.h),
      ),
    )
    ordered.forEach((node, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      targets.set(node.id, {
        x: left + colWidths.slice(0, col).reduce((sum, width) => sum + width + gap, 0),
        y: top + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0),
      })
    })
  }

  store.beginPlan(`agent-arrange:${createId('plan')}`, 'Agent 排列节点')
  const graph = store.getSnapshot()
  const settled: { x: number; y: number; w: number; h: number }[] = []
  const fixed = snapshotRects(graph.nodes.filter((other) => !unique.includes(other.id)))
  const remaining = ordered.map((node) => ({ ...node }))
  while (remaining.length > 0) {
    const node = remaining.shift()!
    const current = remaining.map((item) => ({ ...item }))
    const target = targets.get(node.id)!
    const final = avoidRectOverlap(
      { ...node, ...target },
      [
        ...fixed,
        ...settled,
        ...current,
      ],
      undefined,
      'right',
    )
    targets.set(node.id, { x: final.x, y: final.y })
    store.dispatch({
      kind: 'node.move',
      ids: [node.id],
      dx: final.x - node.x,
      dy: final.y - node.y,
      phase: 'end',
    })
    settled.push({ x: final.x, y: final.y, w: node.w, h: node.h })
  }
  store.endPlan()
  await store.flush()
  return {
    ok: true,
    layout,
    positions: ordered.map((node) => ({
      nodeId: node.id,
      x: Math.round(targets.get(node.id)!.x),
      y: Math.round(targets.get(node.id)!.y),
    })),
  }
}

async function resizeNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要调整的节点'] }
  const { nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  if (nodes.some((node) => !isTopLevelNode(node))) {
    return { ok: false, problems: ['组内节点的位置与尺寸由容器管理，请把节点移出组后再调整'] }
  }
  const scale = Number(args.scale)
  const width = Number(args.width)
  const height = Number(args.height)
  const scaled = Number.isFinite(scale) && scale > 0
  const uniformWidth = Number.isFinite(width) && width > 0
  const uniformHeight = Number.isFinite(height) && height > 0
  const specified = Number(scaled) + Number(uniformWidth) + Number(uniformHeight)
  if (specified > 1) {
    return { ok: false, problems: ['width / height / scale 只能指定其中一项'] }
  }
  if (specified === 0 && args.useMax !== true) {
    return { ok: false, problems: ['请提供 width / height / scale，或 useMax:true'] }
  }
  const useMax = args.useMax === true
  const uniformW = uniformWidth
    ? Number.isFinite(width)
      ? width
      : useMax
        ? Math.max(...nodes.map((node) => node.w))
        : Math.min(...nodes.map((node) => node.w))
    : 0
  const uniformH = uniformHeight
    ? Number.isFinite(height)
      ? height
      : useMax
        ? Math.max(...nodes.map((node) => node.h))
        : Math.min(...nodes.map((node) => node.h))
    : 0
  const changes = nodes.map((node) => {
    const ratio = node.w / Math.max(1, node.h)
    let w = node.w
    let h = node.h
    if (scaled) {
      w *= scale
      h *= scale
    } else if (uniformWidth) {
      w = uniformW
      h = uniformW / ratio
    } else {
      h = uniformH
      w = uniformH * ratio
    }
    const min = nodeMinSize(node)
    /**
     * 最小尺寸也必须等比放大。分别对宽高取 max 会把 16:10 变成 1.25:1，
     * 用户看到的是图片被拉伸，和工具承诺的“保持原始宽高比”冲突。
     */
    const minScale = Math.max(
      1,
      min.w / Math.max(1, w),
      min.h / Math.max(1, h),
    )
    const rect = {
      x: node.x,
      y: node.y,
      w: w * minScale,
      h: h * minScale,
    }
    return { node, rect }
  })
  const graph = store.getSnapshot()
  store.beginPlan(`agent-resize:${createId('plan')}`, 'Agent 调整节点尺寸')
  const adjusted: { nodeId: string; w: number; h: number; x: number; y: number }[] = []
  for (const { node, rect } of changes) {
    const occupied = [
      ...snapshotRects(graph.nodes.filter((other) => !ids.includes(other.id))),
      ...nodes
        .filter((other) => other.id !== node.id)
        .map((other) => {
          const previous = adjusted.find((item) => item.nodeId === other.id)
          return previous ?? { x: other.x, y: other.y, w: other.w, h: other.h }
        }),
    ]
    const final = avoidRectOverlap(rect, occupied, undefined, 'right')
    store.dispatch({ kind: 'node.resize', id: node.id, rect: final, phase: 'end' })
    const moved = placeNodeWithoutOverlap(store, node.id, final)
    adjusted.push({
      nodeId: node.id,
      w: Math.round(final.w),
      h: Math.round(final.h),
      x: Math.round(moved.x),
      y: Math.round(moved.y),
    })
  }
  store.endPlan()
  await store.flush()
  return { ok: true, nodes: adjusted }
}

async function deleteNodesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const ids = asStringArray(args.nodeIds)
  if (ids.length === 0) return { ok: false, problems: ['没有指定要删除的节点'] }
  const { nodes, missing } = selectedNodes(store, ids)
  if (missing.length > 0) return { ok: false, problems: [`节点不存在：${missing.join('、')}`] }
  const graph = store.getSnapshot()
  const beforeIds = new Set(graph.nodes.map((node) => node.id))
  store.dispatch({ kind: 'node.delete', ids: nodes.map((node) => node.id) })
  await store.flush()
  return {
    ok: true,
    deletedNodeIds: [...beforeIds].filter(
      (id) => !store.getSnapshot().nodes.some((node) => node.id === id),
    ),
  }
}

async function deleteEdgesInStore(store: CanvasStore, args: Record<string, unknown>) {
  const graph = store.getSnapshot()
  const requested = new Set(asStringArray(args.edgeIds))
  const pairs = Array.isArray(args.pairs) ? args.pairs.map(asRecord) : []
  for (const edge of graph.edges) {
    if (
      pairs.some(
        (pair) =>
          pair.source === edge.source &&
          pair.target === edge.target,
      )
    ) {
      requested.add(edge.id)
    }
  }
  const existing = [...requested].filter((id) => graph.edges.some((edge) => edge.id === id))
  if (existing.length === 0) {
    return { ok: false, problems: ['没有找到要删除的连线'] }
  }
  store.beginPlan(`agent-unlink:${createId('plan')}`, 'Agent 取消连线')
  for (const id of existing) store.dispatch({ kind: 'edge.remove', id })
  store.endPlan()
  await store.flush()
  return { ok: true, deletedEdgeIds: existing }
}

async function compareNodesInStore(
  store: CanvasStore,
  args: Record<string, unknown>,
) {
  const leftId = typeof args.leftNodeId === 'string' ? args.leftNodeId : ''
  const rightId = typeof args.rightNodeId === 'string' ? args.rightNodeId : ''
  if (!leftId || !rightId || leftId === rightId) {
    return { ok: false, problems: ['需要两个不同的节点 id'] }
  }
  const graph = store.getSnapshot()
  const left = graph.nodes.find((node) => node.id === leftId)
  const right = graph.nodes.find((node) => node.id === rightId)
  if (!left || !right) return { ok: false, problems: ['对比节点不存在'] }
  if (
    !(left.data as { assetHash?: unknown }).assetHash ||
    !(right.data as { assetHash?: unknown }).assetHash
  ) {
    return { ok: false, problems: ['两个节点都必须已有图片'] }
  }
  if ((left.parentId ?? null) !== (right.parentId ?? null)) {
    return { ok: false, problems: ['对比的两个节点必须在同一层级'] }
  }
  if (left.parentId || right.parentId) {
    return { ok: false, problems: ['组内节点请移出组后再创建对比节点'] }
  }
  const spec = getSpec('compare')
  if (!spec) return { ok: false, problems: ['对比节点尚未注册'] }
  const id = createId('node')
  const at = {
    x: Math.max(left.x + left.w, right.x + right.w) + 80,
    y: Math.min(left.y, right.y),
  }
  const comparisonSize = getSpec('compare')?.sizing?.min ?? { w: 360, h: 270 }
  const placedAt = avoidRectOverlap(
    { ...at, ...comparisonSize },
    graph.nodes.map((node) => ({ x: node.x, y: node.y, w: node.w, h: node.h })),
  )
  store.beginPlan(`agent-compare:${id}`, 'Agent 创建对比')
  store.dispatch({
    kind: 'node.create',
    projectId: graph.projectId,
    type: 'compare',
    id,
    at: placedAt,
    title: `${left.title} / ${right.title} 对比`,
    ...(left.parentId ? { parentId: left.parentId } : {}),
    data: spec.createDefaultData(),
  })
  store.dispatch({ kind: 'edge.connect', source: left.id, target: id })
  store.dispatch({ kind: 'edge.connect', source: right.id, target: id })
  store.endPlan()
  store.setSelection([id])
  await store.flush()
  return { ok: true, compareNodeId: id }
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
      const existing = ctx.store.getSnapshot().nodes.map((n) => n.id)
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
