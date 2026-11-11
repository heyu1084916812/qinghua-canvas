import type {
  ReferenceItem,
  ReferenceUsage,
  ReferenceUsageKind,
} from './referenceLedger'
import { curatedTitleOf } from './referenceTitle'

export const REFERENCE_CURATION_PROMPT_VERSION = 1

export const REFERENCE_USAGE_KINDS: readonly ReferenceUsageKind[] = [
  'subject',
  'style',
  'composition',
  'identityAnchor',
  'avoid',
  'textGuide',
]

export interface ReferenceCurationAnalysis {
  /** C1：按主体 / 用途起的短名；模型没给或给成文件名时为空串。 */
  title: string
  what: string
  usage: ReferenceUsageKind
  howToUse: string
  identityAnchor: boolean
  limitations: string[]
}

export interface ReferenceCurationResult {
  ok: boolean
  summary: string
  taskKey: string
  analyzed: {
    itemId: string
    title: string
    what: string
    usage: ReferenceUsage['usage']
    howToUse: string
  }[]
  failed: {
    itemId: string
    title: string
    reason: string
  }[]
  limitations: string[]
}

export type ParsedReferenceCuration =
  | { ok: true; analysis: ReferenceCurationAnalysis }
  | { ok: false; reason: string }

export const REFERENCE_CURATION_SYSTEM_PROMPT = [
  '你是轻画的项目参考分析子代理。',
  '你只能分析随消息提供的真实参考图和参考卡文字，不能修改画布、生成图片或假装看过未提供的素材。',
  'title 按画面主体或用途起一个 2～12 字的短名（如「拿铁杯产品图」「极简海报排版」「品牌 Logo」），不要用文件名。',
  'What 只写可核对的主体、结构、材质、颜色、字体、构图和视觉风格，不要编造品牌故事或用途；颜色用文字描述，不要自己写 HEX（系统会本地采样补上色值）。',
  'HowToUse 只写两件事，格式「借：…；避：…」：借这张图里真实存在的哪些元素（必要时注明锁定身份），',
  '避开图里哪些不该沿用的内容。不要提出图里没有的新设计建议（如加插画、信息图、新图形、新文案、排版方案），',
  '那是生成阶段的事，不属于这张参考的用法。',
  'usage 只能是 subject / style / composition / identityAnchor / avoid / textGuide。',
  '要放进画面且必须保持外形的产品 / 商品实物 / 主体用 subject（锁定外形、结构、材质、颜色，只换场景）。',
  'Logo、标志、角色身份等必须原样保留时用 identityAnchor，并把 identityAnchor 写为 true。',
  '只是氛围、色彩或质感参考时用 style；构图和版式参考用 composition；明确不该沿用的内容用 avoid。',
  '色彩规范、字体规范、文案规范用 textGuide。看不清或信息不足写进 limitations，不能猜。',
  '只输出一个 JSON 对象，不要 Markdown、代码围栏或额外说明。',
  'JSON 形状：',
  '{"title":"主体或用途短名","what":"客观素材说明","usage":"subject|style|composition|identityAnchor|avoid|textGuide",',
  '"howToUse":"当前任务如何使用","identityAnchor":false,"limitations":["无法确认的内容"]}',
].join('\n')

export function buildReferenceCurationPrompt(input: {
  item: ReferenceItem
  task: string
  imageLabels: readonly string[]
}): string {
  const item = input.item
  const lines = [
    '## 本次任务',
    input.task.trim() || '请分析这条参考，并给出可用于后续生成的具体用法。',
    '',
    '## 参考卡',
    `id: ${item.id}`,
    `title: ${item.title}`,
    `source: ${item.source}`,
    `kind: ${item.kind}`,
    ...(item.kitId ? [`kit: ${item.kitId}`] : []),
    ...(item.kitVersion ? [`kitVersion: ${item.kitVersion}`] : []),
    `existingWhat: ${item.what}`,
    '',
    '## 随消息提供的图片',
    ...(input.imageLabels.length > 0
      ? input.imageLabels.map((label, index) => `- 图片 ${index + 1}: ${label}`)
      : ['- 没有图片；只能依据参考卡文字分析，并在 limitations 中说明。']),
    '',
    '## 输出要求',
    'what 和 howToUse 都必须非空，并直接对应当前任务。',
    'howToUse 只写「借：图中已有的元素；避：图中不该沿用的内容」，不写图里没有的设计建议。',
    '不要把搜索结果、项目其他参考或画布节点当成这条参考的一部分。',
  ]
  return lines.join('\n')
}

export function parseReferenceCurationText(
  raw: string,
): ParsedReferenceCuration {
  const parsed = jsonObjectFrom(raw)
  if (!parsed) return { ok: false, reason: '模型没有返回可解析的 JSON' }
  const what = textOf(parsed.what, 2_000)
  const howToUse = textOf(parsed.howToUse, 2_000)
  if (!what) return { ok: false, reason: '分析结果缺少 What' }
  if (!howToUse) return { ok: false, reason: '分析结果缺少 HowToUse' }
  const usage = usageKindOf(parsed.usage)
  if (!usage) return { ok: false, reason: '分析结果缺少有效 usage' }
  const limitations = (Array.isArray(parsed.limitations)
    ? parsed.limitations
    : [])
    .map((item) => textOf(item, 500))
    .filter(Boolean)
    .slice(0, 12)
  return {
    ok: true,
    analysis: {
      title: curatedTitleOf(parsed.title),
      what,
      usage,
      howToUse,
      identityAnchor:
        parsed.identityAnchor === true || usage === 'identityAnchor',
      limitations,
    },
  }
}

/**
 * 同一项目、任务和参考只对应一个 usage 行。任务切换会产生新行，
 * 同一任务重跑只更新原行，避免台账无限重复。
 */
export function referenceUsageId(input: {
  projectId: string
  taskKey: string
  itemId: string
}): string {
  const text = `${input.projectId}|${input.taskKey}|${input.itemId}`
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `usage_${(hash >>> 0).toString(36)}`
}

function jsonObjectFrom(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(trimmed.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function textOf(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
    : ''
}

function usageKindOf(value: unknown): ReferenceUsageKind | null {
  const raw = textOf(value, 80).toLowerCase()
  const canonical = REFERENCE_USAGE_KINDS.find(
    (kind) => kind.toLowerCase() === raw,
  )
  if (canonical) return canonical
  const aliases: Record<string, ReferenceUsageKind> = {
    风格: 'style',
    色彩: 'style',
    质感: 'style',
    构图: 'composition',
    版式: 'composition',
    身份: 'identityAnchor',
    标志: 'identityAnchor',
    主体: 'subject',
    产品: 'subject',
    商品: 'subject',
    避开: 'avoid',
    禁用: 'avoid',
    文字: 'textGuide',
    字体: 'textGuide',
    规范: 'textGuide',
  }
  return aliases[textOf(value, 80)] ?? null
}
