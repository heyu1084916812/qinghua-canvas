export interface ScreenPoint {
  x: number
  y: number
}

/** 一条线被切开后的两段折线（**屏幕坐标**，直接喂给动画层的 `<path d>`） */
export interface CutHalves {
  top: string
  bottom: string
  /** 切点序号（合法范围 1..n-2）：调用方据此断言"切在中间而不是端点上" */
  index: number
}

const toPath = (points: readonly ScreenPoint[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

/**
 * 把一条**采样好的折线**在离指针最近的那一段切开（对账 #1159）。
 *
 * 为什么先采样成折线、而不是在贝塞尔上做精确分割：
 * - 视觉上 48～64 段已经看不出折线（画布缩放后一段往往不到 3px）；
 * - 分割要的是"两段各自的 `d`"，采样后直接拼字符串，不依赖 `getPointAtLength` 的
 *   二次测量，动画层也不需要知道原始边是哪条贝塞尔。
 *
 * 两端各留一格（`index` 限制在 `1..n-2`）：切在最端点等于把整条线变成"一段 + 空"，
 * 动画看起来像线自己消失 —— 那不是"切"的语义。
 */
export function cutPolylineAt(points: readonly ScreenPoint[], pointer: ScreenPoint): CutHalves | null {
  if (points.length < 3) return null
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i]!.x - pointer.x
    const dy = points[i]!.y - pointer.y
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  const index = Math.min(Math.max(best, 1), points.length - 2)
  return {
    top: toPath(points.slice(0, index + 1)),
    bottom: toPath(points.slice(index)),
    index,
  }
}

/** 采样点是否落在一条边上：只用于探针/单测，判断"切到了这条线" */
export function distanceToPolyline(points: readonly ScreenPoint[], pointer: ScreenPoint): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    const vx = b.x - a.x
    const vy = b.y - a.y
    const lengthSq = vx * vx + vy * vy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((pointer.x - a.x) * vx + (pointer.y - a.y) * vy) / lengthSq))
    const px = a.x + vx * t
    const py = a.y + vy * t
    best = Math.min(best, Math.hypot(pointer.x - px, pointer.y - py))
  }
  return best
}

export interface SegmentHit {
  point: ScreenPoint
  /** 命中点落在这段折线的第几段（points[index] → points[index+1]） */
  index: number
}

/**
 * **刀锋扫过**的求交（对账 #1159 第二轮）：把上一帧到这一帧的鼠标轨迹当成一条线段，
 * 与折线逐段做 2D 跨立相交。
 *
 * 为什么不能只测"当前点是否在线上"：快速挥刀时相邻两帧可能隔上百像素，
 * 连线正好从两点之间穿过去 —— 点检测会整刀漏切（用户实测"切不了线条"）。
 */
export function segmentHitsPolyline(
  points: readonly ScreenPoint[],
  from: ScreenPoint,
  to: ScreenPoint,
): SegmentHit | null {
  if (points.length < 2) return null
  const rx = to.x - from.x
  const ry = to.y - from.y
  if (rx === 0 && ry === 0) return null
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!
    const b = points[i + 1]!
    const sx = b.x - a.x
    const sy = b.y - a.y
    const denom = rx * sy - ry * sx
    if (Math.abs(denom) < 1e-9) continue
    const qx = a.x - from.x
    const qy = a.y - from.y
    const t = (qx * sy - qy * sx) / denom
    const u = (qx * ry - qy * rx) / denom
    if (t < 0 || t > 1 || u < 0 || u > 1) continue
    return { point: { x: from.x + t * rx, y: from.y + t * ry }, index: i }
  }
  return null
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 屏幕线段的包围盒（"先粗筛再细算"用；`pad` 是容差） */
export function segmentBox(from: ScreenPoint, to: ScreenPoint, pad = 0): Box {
  return {
    minX: Math.min(from.x, to.x) - pad,
    minY: Math.min(from.y, to.y) - pad,
    maxX: Math.max(from.x, to.x) + pad,
    maxY: Math.max(from.y, to.y) + pad,
  }
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)
}