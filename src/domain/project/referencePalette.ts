/**
 * C3：参考图主色（HEX），本地从像素统计得出，不调外部接口、不让模型猜色值。
 *
 * 输入是 RGBA 像素（调用方先把图缩到几十像素见方再采样）。做法：
 * 每通道量化到 4 bit（4096 桶）→ 统计每桶像素数与平均色 → 按数量排序 →
 * 把与已选颜色太接近（RGB 欧氏距离 < 48）的桶并进去 → 取占比 ≥ minShare 的前 max 个。
 * 透明像素（alpha < 128）不计。纯函数。
 */

export interface PaletteColor {
  hex: string
  /** 占不透明像素的比例，0～1。 */
  share: number
}

const MERGE_DISTANCE = 48

function hexOf(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`
}

export function dominantHexColors(
  rgba: ArrayLike<number>,
  options: { max?: number; minShare?: number } = {},
): PaletteColor[] {
  const max = options.max ?? 5
  const minShare = options.minShare ?? 0.03
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let total = 0
  for (let at = 0; at + 3 < rgba.length; at += 4) {
    if (rgba[at + 3]! < 128) continue
    const r = rgba[at]!
    const g = rgba[at + 1]!
    const b = rgba[at + 2]!
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bucket.count += 1
    bucket.r += r
    bucket.g += g
    bucket.b += b
    buckets.set(key, bucket)
    total += 1
  }
  if (total === 0) return []
  const merged: { count: number; r: number; g: number; b: number }[] = []
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    const color = { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count }
    const near = merged.find((row) => {
      const dr = row.r / row.count - color.r
      const dg = row.g / row.count - color.g
      const db = row.b / row.count - color.b
      return Math.sqrt(dr * dr + dg * dg + db * db) < MERGE_DISTANCE
    })
    if (near) {
      near.count += bucket.count
      near.r += bucket.r
      near.g += bucket.g
      near.b += bucket.b
    } else {
      merged.push({ ...bucket })
    }
  }
  return merged
    .sort((a, b) => b.count - a.count)
    .map((row) => ({ hex: hexOf(row.r / row.count, row.g / row.count, row.b / row.count), share: row.count / total }))
    .filter((row) => row.share >= minShare)
    .slice(0, max)
}

/** 写进参考卡 What 的一句：「主色（本地像素采样）：#1F3D2B 42%、#F4EFE6 30%」。 */
export function paletteSentence(colors: readonly PaletteColor[]): string {
  if (colors.length === 0) return ''
  return `主色（本地像素采样）：${colors
    .map((color) => `${color.hex} ${Math.round(color.share * 100)}%`)
    .join('、')}`
}
