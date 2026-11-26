import type { AgentPlan, AgentPlanNode } from './plan'

const ECOMMERCE_INTENT =
  /电商|淘宝|天猫|京东|拼多多|抖音商城|亚马逊|amazon|商品套图|商品主图|产品套图|白底图|卖点图|详情页|店铺首页|商品卡|listing|product page/i

const IMAGE_DELIVERY_INTENT =
  /做|画|生成|设计|出图|改图|重绘|制作|搭建|需要|想要|给我|五张|一套|套图/i

const TYPOGRAPHY_INTENT =
  /文字|文案|排版|主标题|副标题|标题层级|字体|字号|卖点布局|信息层级|文字层/i

const TYPOGRAPHY_MARKERS =
  /文字|文案|排版|主标题|副标题|标题|字体|字号|字重|卖点标签|信息层级|文字层/i

const PLAIN_PRODUCT_TITLE =
  /白底|纯白底|抠图|去背|去底|透明背景|透明底|商品抠图|产品抠图/i

export function isEcommerceImageTask(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  if (/^(解释|怎么|如何|为什么|教程|规则|步骤)/.test(compact)) return false
  return ECOMMERCE_INTENT.test(compact) && IMAGE_DELIVERY_INTENT.test(compact)
}

export function requiresEcommerceTypography(text: string): boolean {
  return TYPOGRAPHY_INTENT.test(text.replace(/\s+/g, ''))
}

export function ecommerceArtDirectionPrompt(input: {
  typographyRequired: boolean
}): string {
  return [
    '## 电商视觉硬约束',
    '- 这是电商图片交付，不是单张概念图。主图、套图与详情页必须共享同一套产品外观、比例、主色、光线和版式节奏。',
    '- 先建立产品锚点或首屏 KV，再让卖点图、场景图、细节图和详情页从该锚点延展；计划里用真实连线表达派生关系，不能各画各的。',
    input.typographyRequired
      ? '- 用户明确要求文字排版：每个非白底 / 非抠图的生成提示词都要写清真实文案、标题/副标题层级、字体风格、字号关系、位置、颜色和留白，不得把排版留给默认配方。'
      : '- 电商套图中至少要有一张承担标题与卖点信息层级；不能因为通用模型默认而静默省略电商版式文字。',
    '- 用户本轮明确给出的商品卖点、文案、比例和平台规则优先于 Skill 默认值。',
  ].join('\n')
}

function promptOf(node: AgentPlanNode): string {
  const value = node.data.prompt
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function isImageGeneration(node: AgentPlanNode): boolean {
  return node.type === 'generation' && node.data.mode !== 'video'
}

/**
 * 电商计划落地前的确定性检查。
 *
 * 只靠 Skill 正文无法阻止模型在计划里遗漏排版或把五张图做成五条互不相关的链；
 * 这两类错误到出图后才暴露，返工成本最高。这里把可判断的硬要求提前拦住。
 */
export function ecommercePlanProblems(
  plan: Pick<AgentPlan, 'nodes' | 'edges'>,
  input: { typographyRequired: boolean },
): string[] {
  const generations = plan.nodes.filter(isImageGeneration)
  if (generations.length < 2) return []

  const problems: string[] = []
  const upstream = new Map<string, string[]>()
  for (const edge of plan.edges) {
    upstream.set(edge.target, [...(upstream.get(edge.target) ?? []), edge.source])
  }
  const lineageOf = (id: string): Set<string> => {
    const seen = new Set<string>([id])
    const pending = [...(upstream.get(id) ?? [])]
    while (pending.length > 0) {
      const next = pending.pop()!
      if (seen.has(next)) continue
      seen.add(next)
      pending.push(...(upstream.get(next) ?? []))
    }
    return seen
  }
  const lineages = generations.map((node) => lineageOf(node.localId))
  const byId = new Map(plan.nodes.map((node) => [node.localId, node]))
  const common = [...lineages[0]!].filter((id) => {
    const node = byId.get(id)
    const visualCapable = node && node.type !== 'prompt' && node.type !== 'loop'
    return Boolean(visualCapable) && lineages.slice(1).every((lineage) => lineage.has(id))
  })
  if (common.length === 0) {
    problems.push(
      '这份电商套图没有共同锚点：请先建一个产品参考 / 白底主图 / 首屏 KV，' +
        '再让其余图片通过 edges 从它延展；或者让所有生成节点共同引用同一张产品参考。',
    )
  }

  const hasTypography = generations.some((node) => TYPOGRAPHY_MARKERS.test(promptOf(node)))
  if (input.typographyRequired) {
    const missing = generations.filter((node) => {
      if (PLAIN_PRODUCT_TITLE.test(node.title ?? '')) return false
      return !TYPOGRAPHY_MARKERS.test(promptOf(node))
    })
    if (missing.length > 0) {
      problems.push(
        `用户要求文字排版，但这些图片的提示词没有写清文字层级：` +
          `${missing.map((node) => `「${node.title || node.localId}」`).join('、')}。` +
          '请为每张图写明真实文案、主标题 / 副标题、字体、位置与颜色；纯白底或抠图节点可明确标注不排字。',
      )
    }
  } else if (!hasTypography) {
    problems.push(
      '电商套图里没有任何节点承担标题与卖点排版。请至少给一张主图 / 卖点图写清真实文案和信息层级，' +
        '不要静默生成一组没有电商版式的图片。',
    )
  }
  return problems
}
