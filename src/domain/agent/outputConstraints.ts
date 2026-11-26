const UNIFORM_RATIO_HINT =
  /统一|同一|一致|全部|全都|都用|每张|整组|整套|一套/

function normalized(text: string): string {
  return text.replace(/\s+/g, '').trim()
}

/**
 * 只提取“整组统一”的明确比例。
 *
 * 普通提到一个比例不一定是整组要求（例如“主图 1:1，详情页 3:4”），
 * 所以必须有“统一 / 都 / 全部 / 每张”等范围词，且全文只能出现一个比例。
 */
export function uniformImageRatioOf(text: string): string | undefined {
  const source = normalized(text)
  if (!UNIFORM_RATIO_HINT.test(source)) return undefined
  const ratios = new Set<string>()
  const pattern = /(^|[^\d])(\d{1,2})\s*[:：]\s*(\d{1,2})(?!\d)/g
  for (const match of source.matchAll(pattern)) {
    const width = Number(match[2])
    const height = Number(match[3])
    if (width > 0 && height > 0) ratios.add(`${width}:${height}`)
  }
  return ratios.size === 1 ? [...ratios][0] : undefined
}

/**
 * 电商图片的整组比例：用户只有一个明确比例时用它；完全没提比例时用技能默认 1:1；
 * 用户在同一句里给了多个比例（例如主图 1:1、详情页 3:4）则不擅自统一。
 */
export function ecommerceImageRatioOf(text: string): string | undefined {
  const source = normalized(text)
  const ratios = new Set<string>()
  const pattern = /(^|[^\d])(\d{1,2})\s*[:：]\s*(\d{1,2})(?!\d)/g
  for (const match of source.matchAll(pattern)) {
    const width = Number(match[2])
    const height = Number(match[3])
    if (width > 0 && height > 0) ratios.add(`${width}:${height}`)
  }
  if (ratios.size === 0) return '1:1'
  return ratios.size === 1 ? [...ratios][0] : undefined
}

export function uniformImageRatioPrompt(ratio: string): string {
  return [
    '## 本轮固定输出比例',
    `用户明确要求整组图片统一为 ${ratio.trim()}。`,
    '所有新建生成节点的 `data.ratio` 必须写这个值；不要给某张图换比例，也不要省略让默认配方补。',
  ].join('\n')
}
