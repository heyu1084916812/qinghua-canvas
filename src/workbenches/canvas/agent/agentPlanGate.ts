import {
  normalizeAgentPlan,
  validateAgentPlan,
  type AgentNodeType,
  type AgentPlan,
} from '../../../domain/agent/plan'
import { asRecord } from './canvasReadTools'

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

export interface ExistingAgentNode {
  id: string
  type: AgentNodeType
}

function alignAttachedNodeTypes(
  raw: unknown,
  existing: ReadonlyMap<string, AgentNodeType>,
): unknown {
  if (existing.size === 0) return raw
  const row = asRecord(raw)
  if (!Array.isArray(row.nodes) || !Array.isArray(row.attach)) return raw
  const attachedByLocalId = new Map(
    row.attach.flatMap((item) => {
      const entry = asRecord(item)
      return typeof entry.localId === 'string' && entry.localId
        ? [[entry.localId, entry] as const]
        : []
    }),
  )
  let changed = false
  const nodes = row.nodes.map((item) => {
    const node = asRecord(item)
    const localId =
      typeof node.localId === 'string' ? node.localId : ''
    const existingNodeId =
      typeof attachedByLocalId.get(localId)?.existingNodeId === 'string'
        ? String(attachedByLocalId.get(localId)!.existingNodeId)
        : ''
    const actualType = existing.get(existingNodeId)
    if (!actualType || node.type === actualType) return node
    changed = true
    return { ...node, type: actualType }
  })
  return changed ? { ...row, nodes } : raw
}

export function planProblems(
  args: unknown,
  existingNodes: readonly (string | ExistingAgentNode)[],
): { problems: string[]; plan: AgentPlan | null } {
  const existingNodeIds = existingNodes.map((node) =>
    typeof node === 'string' ? node : node.id,
  )
  const existingTypes = new Map(
    existingNodes.flatMap((node) =>
      typeof node === 'string' ? [] : [[node.id, node.type] as const],
    ),
  )
  const aligned = alignAttachedNodeTypes(args, existingTypes)
  const { plan } = normalizeAgentPlan(
    disambiguateAttachAliases(aligned),
  )
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
