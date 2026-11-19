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
