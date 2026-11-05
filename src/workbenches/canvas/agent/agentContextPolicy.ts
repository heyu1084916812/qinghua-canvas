import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { summarizeGraph, type GraphSummary } from './tools'

export type AgentRequestMode =
  | 'simple_generate'
  | 'reference_edit'
  | 'design_research'
  | 'canvas_operation'
  | 'complex_plan'

export type AgentPromptProfile = 'light' | 'full'

export interface AgentRequestSignals {
  text: string
  hasMentionedImage: boolean
  hasSelectedNodes: boolean
  hasSelectedImage: boolean
  hasTaskPlan: boolean
}

const EMPTY_GRAPH_SUMMARY: GraphSummary = { nodes: [], edges: [] }

const MULTI_STAGE_PATTERN =
  /整套|套件|视觉规范|品牌\s*vi|vi\s*系统|品牌(?:视觉|套件)|全案|系列物料|批量|多阶段|分镜脚本|详情页|第一步|第二步|阶段|先.{0,24}(?:再|然后|接着|最后)|(?:然后|接着|之后).{0,40}(?:再|继续|最后)/i

const DESIGN_RESEARCH_PATTERN =
  /设计调研|设计研究|设计灵感|视觉参考|灵感采集|找(?:一些|点)?参考|收集(?:一些|点)?(?:素材|参考|灵感)|参考(?:案例|网站|页面)|mood\s*board|情绪板|竞品(?:分析|调研)|design\s*research/i

const RESEARCH_SOURCE_PATTERN = /pinterest|behance|pixiv|p站/i
const RESEARCH_ACTION_PATTERN = /找|收集|看看|调研|参考|灵感|案例|mood\s*board|情绪板/i

const CANVAS_ACTION_PATTERN =
  /移动|挪动|拖到|排列|排成|对齐|布局|整理|缩放|调整大小|改大小|居中|放到|移到|删除(?:节点|连线)|取消连线|新建连线|选中|框选/

const CANVAS_OBJECT_PATTERN = /节点|图片|图像|画布|连线|选中/

/** 明确是画布布局，即使正文省略了「节点 / 图片」名词。 */
const IMPLICIT_CANVAS_LAYOUT_PATTERN =
  /(?:排列|排成|整理|移动|挪动|拖到|放到|放在).{0,20}(?:一排|一行|整齐|对齐|空位置|空白处|空白区域|布局)/

const GENERATION_THEN_LAYOUT_PATTERN =
  /\d+\s*张|生成(?:后|完)|先.{0,12}(?:生成|出图|绘制)/

const SHORT_CANVAS_ACTION_PATTERN =
  /^(?:帮我)?(?:移动|挪一下|排一下|排列|对齐|布局|整理|缩放|缩一下|调整大小|居中)(?:一下|下|好|整齐)?$/

/**
 * 描述 / 识别图片是主对话视觉理解，不是验收。只有明确的质检目的才加载
 * visualReview，避免“这个图有什么”被改写成另一项任务。
 */
export function requestsVisualReview(text: string): boolean {
  const normalized = normalizedText(text)
  if (/视觉验收|验收|巡检画布|检查作品|质量把关/.test(normalized)) return true
  if (/(有没有问题|有何问题|什么问题|有没有错)/.test(normalized)) return true
  return /(检查|验收|审查|评估|核对|看看|查看)/.test(normalized) &&
    /(是否一致|一致性|有没有问题|有何问题|什么问题|瑕疵|错字|质量|合规|是否符合|有没有错)/.test(normalized)
}

const EDIT_INTENT_PATTERN =
  /换|改|替换|调整|优化|修改|修一下|重绘|再生成|参考|基于|保持|变成|做成|加一个|去掉/

function normalizedText(text: string): string {
  return text.replace(/\s+/g, '').trim()
}

export function classifyAgentRequest(signals: AgentRequestSignals): AgentRequestMode {
  const text = normalizedText(signals.text)
  if (signals.hasTaskPlan || MULTI_STAGE_PATTERN.test(text)) {
    return 'complex_plan'
  }
  if (DESIGN_RESEARCH_PATTERN.test(text)) {
    return 'design_research'
  }
  if (
    IMPLICIT_CANVAS_LAYOUT_PATTERN.test(text) &&
    GENERATION_THEN_LAYOUT_PATTERN.test(text)
  ) {
    return 'complex_plan'
  }
  if (
    requestsVisualReview(text) ||
    IMPLICIT_CANVAS_LAYOUT_PATTERN.test(text) ||
    (CANVAS_ACTION_PATTERN.test(text) && CANVAS_OBJECT_PATTERN.test(text)) ||
    (signals.hasSelectedNodes && SHORT_CANVAS_ACTION_PATTERN.test(text))
  ) {
    return 'canvas_operation'
  }
  if (
    signals.hasMentionedImage ||
    (signals.hasSelectedImage && EDIT_INTENT_PATTERN.test(text))
  ) {
    return 'reference_edit'
  }
  if (RESEARCH_SOURCE_PATTERN.test(text) && RESEARCH_ACTION_PATTERN.test(text)) {
    return 'design_research'
  }
  return 'simple_generate'
}

export function promptProfileForMode(mode: AgentRequestMode): AgentPromptProfile {
  return mode === 'simple_generate' ||
    mode === 'reference_edit' ||
    mode === 'design_research'
    ? 'light'
    : 'full'
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function nodeHasImageOutput(node: Pick<NodeSnapshot, 'data'>): boolean {
  const data = asRecord(node.data)
  if (typeof data.assetHash !== 'string') return false
  if (data.mode === 'video') return false
  return typeof data.assetMime !== 'string' || data.assetMime.startsWith('image/')
}

export function imageNodeIdsAmong(
  nodes: readonly Pick<NodeSnapshot, 'id' | 'data'>[],
  ids: readonly string[],
): string[] {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  return nodes
    .filter((node) => wanted.has(node.id) && nodeHasImageOutput(node))
    .map((node) => node.id)
}

function referenceNodeIds(
  graph: Pick<GraphSnapshot, 'nodes' | 'edges'>,
  roots: readonly string[],
): string[] {
  if (roots.length === 0) return []
  const known = new Set(graph.nodes.map((node) => node.id))
  const upstreamByTarget = new Map<string, string[]>()
  for (const edge of graph.edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue
    const upstream = upstreamByTarget.get(edge.target) ?? []
    upstream.push(edge.source)
    upstreamByTarget.set(edge.target, upstream)
  }

  const included = new Set<string>()
  const pending = roots.filter((id) => known.has(id))
  while (pending.length > 0) {
    const id = pending.pop()!
    if (included.has(id)) continue
    included.add(id)
    for (const upstream of upstreamByTarget.get(id) ?? []) {
      if (!included.has(upstream)) pending.push(upstream)
    }
  }
  return graph.nodes.filter((node) => included.has(node.id)).map((node) => node.id)
}

export function summaryForAgentRequest(
  graph: Pick<GraphSnapshot, 'nodes' | 'edges'>,
  mode: AgentRequestMode,
  referenceRootIds: readonly string[] = [],
): GraphSummary {
  if (mode === 'simple_generate' || mode === 'design_research') return EMPTY_GRAPH_SUMMARY
  if (mode === 'reference_edit') {
    return summarizeGraph(graph, referenceNodeIds(graph, referenceRootIds))
  }
  return summarizeGraph(graph)
}

export function resolveAgentSkillForTurn(
  skillChipIds: readonly string[],
  selectedSkillId?: string,
): string | undefined {
  if (skillChipIds.length === 0) return undefined
  return selectedSkillId && skillChipIds.includes(selectedSkillId)
    ? selectedSkillId
    : skillChipIds[0]
}
