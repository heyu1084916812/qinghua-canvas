import type { GenerationContextAsset, GenerationContextAssetUsage } from '../model/node'
import type { NodeInput } from '../model/runRecord'

/**
 * 生成节点随附参考图的「分工说明」（G2，多图分角色）。
 *
 * Lovart 对照（review/lovart-ref-flow-interview.md 问题 5）：多张参考原图都直接交给生图模型，
 * 按顺序对齐，并在生成指令里写明各自分工，例如「图 1：排版参考；图 2：产品主体，保持外形」。
 * 以前这里把非 Logo 图一律称作「品牌素材，核对颜色 / 字体 / 版式」，模型分不清谁管排版、谁管产品。
 *
 * 编号规则：**与真实图片输入顺序一致**。编号来自 `collectInputs` 产出的 asset 输入序列
 * （套件素材在前、上游节点产物在后），不另起一套排序，避免「图 2」说的是另一张图。
 */

const HOW_TO_USE_LIMIT = 60

/** 每种用法的角色名与默认约束；identityAnchor 的 Logo 走 role='logo' 单独一条。 */
const USAGE_ROLE: Record<GenerationContextAssetUsage, { label: string; rule: string }> = {
  subject: {
    label: '产品主体',
    rule: '保持主体的外形、结构、比例、材质与颜色，不得改款或换成相似物，只改变场景、构图与光线',
  },
  identityAnchor: {
    label: '身份锚点',
    rule: '保持主体身份一致（外形、标志性特征、配色），不得重画成另一个对象',
  },
  composition: {
    label: '排版 / 构图参考',
    rule: '借鉴版式布局、画面分区与视觉骨骼，不照抄其中的文字、商品和具体内容',
  },
  style: {
    label: '风格参考',
    rule: '借鉴色调、光影、质感与氛围，不照抄其中的主体和文字',
  },
  textGuide: {
    label: '色彩 / 文字规范',
    rule: '核对品牌色、字体气质与文案规范，不要把规范图本身画进画面',
  },
  avoid: {
    label: '反例',
    rule: '只用来识别需要避开的做法，不得沿用其中的元素',
  },
}

const LEGACY_ROLE = {
  label: '品牌素材',
  rule: '用于核对颜色、字体气质、版式语言和画面规范，不要照抄无关内容',
}

export const LOGO_RULE = '必须按原图保留字形、比例、颜色和标志结构，不得重画或改成相似字样'

function quoted(name: string): string {
  const trimmed = name.trim()
  return trimmed ? `「${trimmed}」` : ''
}

function howToUseNote(text: string | undefined): string {
  const trimmed = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  const short = trimmed.length > HOW_TO_USE_LIMIT
    ? `${trimmed.slice(0, HOW_TO_USE_LIMIT)}…`
    : trimmed
  return `（本任务用法：${short}）`
}

/** 一张参考图在本次生成里的角色行，不含编号。 */
export function contextAssetRoleLine(asset: GenerationContextAsset): string {
  if (asset.role === 'logo') {
    return `品牌 Logo${quoted(asset.name)}——${LOGO_RULE}。`
  }
  const role = asset.usage ? USAGE_ROLE[asset.usage] : LEGACY_ROLE
  return `${role.label}${quoted(asset.name)}——${role.rule}${howToUseNote(asset.howToUse)}。`
}

/** 只保留会真正进入图片输入的套件素材，按 hash 去重（与 `collectInputs` 同一条规则）。 */
export function usableContextAssets(
  assets: readonly GenerationContextAsset[] | undefined,
): GenerationContextAsset[] {
  const seen = new Set<string>()
  const rows: GenerationContextAsset[] = []
  for (const asset of assets ?? []) {
    const hash = asset.hash.trim()
    if (!hash || !asset.mime.startsWith('image/') || seen.has(hash)) continue
    seen.add(hash)
    rows.push(asset)
  }
  return rows
}

/**
 * 写进生图提示词的分工说明。`inputs` 是这次请求真实的输入序列；
 * 没有套件素材时返回空串（普通图生图的提示词保持原样）。
 */
export function contextAssetRolePrompt(
  assets: readonly GenerationContextAsset[] | undefined,
  inputs: readonly NodeInput[],
): string {
  const usable = usableContextAssets(assets)
  if (usable.length === 0) return ''
  const byHash = new Map(usable.map((asset) => [asset.hash.trim(), asset]))
  const lines: string[] = []
  let imageIndex = 0
  let upstreamFrom = 0
  let upstreamCount = 0
  for (const input of inputs) {
    if (input.kind !== 'asset') continue
    imageIndex += 1
    const asset = input.nodeId.startsWith('context-kit:')
      ? byHash.get(input.assetHash)
      : undefined
    if (asset) {
      lines.push(`图 ${imageIndex}：${contextAssetRoleLine(asset)}`)
      continue
    }
    if (upstreamCount === 0) upstreamFrom = imageIndex
    upstreamCount += 1
  }
  if (lines.length === 0) {
    // 输入序列里没有带出套件图（例如被上游去重）：仍按素材顺序说明，不编号。
    lines.push(...usable.map((asset) => `- ${contextAssetRoleLine(asset)}`))
  }
  if (upstreamCount > 0) {
    lines.push(
      upstreamCount === 1
        ? `图 ${upstreamFrom}：上游节点的成品图——本次在它的基础上修改或延展。`
        : `图 ${upstreamFrom}～图 ${upstreamFrom + upstreamCount - 1}：上游节点的成品图——本次在它们的基础上修改或延展。`,
    )
  }
  return ['参考图分工（编号与随附图片顺序一致）：', ...lines].join('\n')
}
