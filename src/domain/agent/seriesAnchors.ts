import type { AgentPlan, AgentPlanNode } from './plan'

/**
 * 整套任务（Logo → 包装 → 海报）的「按节点分配参考」与「锚点串联」（G4）。
 *
 * Lovart 对照（review/lovart-image-gen-interview.md、lovart-agent-interview.md）：
 * 先定核心锚点（Logo），再拿 Logo 图做包装，最后带着 Logo 和包装出海报；默认一口气串行做完，
 * 用户说「先定 Logo」才停下等确认。
 *
 * 轻画有节点：「参考前一节点结果」= 计划里画一条 锚点节点 → 后续节点 的连线。
 * 执行引擎按连线拓扑先跑上游，所以有连线就自然串行，后续节点的图片输入里就是锚点的成品图。
 *
 * 纯函数：只看计划数据，不读画布、不读台账。
 */

export type SeriesNodePurpose = 'logo' | 'packaging' | 'poster' | 'other'

const LOGO_PATTERN = /logo|标志|标识|商标|字标|徽标|品牌标/i
/** 提示词里只认「设计一个 Logo」这类说法；「角落印上 Logo」是画面元素，不是 Logo 节点。 */
const LOGO_DESIGN_PATTERN =
  /^(?:logo|标志|字标|徽标)|(?:设计|做|画|生成|出|绘制)(?:一|个|款|套|版)*.{0,8}(?:logo|标志|字标|徽标|商标)/i
const PACKAGING_PATTERN = /包装|礼盒|瓶身|杯身|罐身|瓶标|标签|贴纸|外盒|袋子|packag/i
const POSTER_PATTERN = /海报|主视觉|\bkv\b|banner|横幅|宣传(?:图|页|单)|详情页|主图|物料|易拉宝|poster/i

const PURPOSE_RANK: Record<Exclude<SeriesNodePurpose, 'other'>, number> = {
  logo: 0,
  packaging: 1,
  poster: 2,
}

const PURPOSE_LABEL: Record<SeriesNodePurpose, string> = {
  logo: 'Logo',
  packaging: '包装',
  poster: '海报',
  other: '其他',
}

function textOfNode(node: Pick<AgentPlanNode, 'title' | 'data'>): {
  title: string
  prompt: string
} {
  const data = node.data ?? {}
  const prompt = typeof data.prompt === 'string'
    ? data.prompt
    : typeof data.text === 'string'
      ? data.text
      : ''
  return { title: node.title ?? '', prompt }
}

/**
 * 节点用途：标题优先（模型给节点起的名最能说明用途），标题判不出再看提示词开头 24 字。
 * 提示词里常顺带出现「印上 Logo」，所以提示词只认「设计一个 Logo」这类说法。
 */
export function seriesNodePurpose(
  node: Pick<AgentPlanNode, 'title' | 'data'>,
): SeriesNodePurpose {
  const { title, prompt } = textOfNode(node)
  if (title.trim()) {
    if (POSTER_PATTERN.test(title)) return 'poster'
    if (PACKAGING_PATTERN.test(title)) return 'packaging'
    if (LOGO_PATTERN.test(title)) return 'logo'
  }
  const head = prompt.trim().slice(0, 24)
  if (POSTER_PATTERN.test(head)) return 'poster'
  if (PACKAGING_PATTERN.test(head)) return 'packaging'
  if (LOGO_DESIGN_PATTERN.test(head)) return 'logo'
  return 'other'
}

/**
 * 给某个新建生成节点分配本轮参考图：
 * - Logo 节点不拿产品主体（subject）和排版参考（composition）——那是包装 / 海报的事；
 * - 其余节点拿全部参考；
 * - 品牌 Logo 永远排第一（生成提示词里它是「图 1」并带硬约束）。
 */
export function allocateContextAssetsForNode<T extends { role: string; usage?: string }>(
  purpose: SeriesNodePurpose,
  assets: readonly T[],
): T[] {
  const kept = purpose === 'logo'
    ? assets.filter(
        (asset) =>
          asset.role === 'logo' ||
          (asset.usage !== 'subject' && asset.usage !== 'composition'),
      )
    : [...assets]
  return [
    ...kept.filter((asset) => asset.role === 'logo'),
    ...kept.filter((asset) => asset.role !== 'logo'),
  ]
}

/**
 * 整套计划的锚点连线检查：计划里同时出现 Logo / 包装 / 海报中的两类以上时，
 * 后一类的每个节点必须（直接或经由其它节点）以前一类节点为上游。缺连线就退回给模型补。
 */
export function seriesAnchorProblems(plan: Pick<AgentPlan, 'nodes' | 'edges'>): string[] {
  const generations = plan.nodes.filter((node) => node.type === 'generation')
  const staged = generations
    .map((node) => ({ node, purpose: seriesNodePurpose(node) }))
    .filter(
      (row): row is { node: AgentPlanNode; purpose: Exclude<SeriesNodePurpose, 'other'> } =>
        row.purpose !== 'other',
    )
  const ranks = [...new Set(staged.map((row) => PURPOSE_RANK[row.purpose]))].sort()
  if (ranks.length < 2) return []
  const upstream = new Map<string, string[]>()
  for (const edge of plan.edges) {
    upstream.set(edge.target, [...(upstream.get(edge.target) ?? []), edge.source])
  }
  const ancestors = (id: string): Set<string> => {
    const seen = new Set<string>()
    const pending = [...(upstream.get(id) ?? [])]
    while (pending.length > 0) {
      const next = pending.pop()!
      if (seen.has(next)) continue
      seen.add(next)
      pending.push(...(upstream.get(next) ?? []))
    }
    return seen
  }
  const problems: string[] = []
  for (const row of staged) {
    const rank = PURPOSE_RANK[row.purpose]
    const previousRank = [...ranks].reverse().find((value) => value < rank)
    if (previousRank === undefined) continue
    const anchors = staged.filter((other) => PURPOSE_RANK[other.purpose] === previousRank)
    const above = ancestors(row.node.localId)
    if (anchors.some((anchor) => above.has(anchor.node.localId))) continue
    const anchor = anchors[0]!
    problems.push(
      `整套任务要先定锚点再延展：「${row.node.title ?? row.node.localId}」（${
        PURPOSE_LABEL[row.purpose]
      }）必须以「${anchor.node.title ?? anchor.node.localId}」（${
        PURPOSE_LABEL[anchor.purpose]
      }）的结果为参考。请在 edges 里补一条 ${anchor.node.localId} → ${row.node.localId}。`,
    )
  }
  return problems
}
