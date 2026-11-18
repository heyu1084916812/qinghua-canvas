/**
 * Key 分组文件夹标签的几何与弹簧形变（移植自 `folder_tabs_ui.html`）。
 *
 * 形状：两侧 15px 斜边 + 顶部 12px 圆角 + 底部 11px 圆角；相邻标签用 -18px 负外边距互相嵌套，
 * 所以「未选中」是各自一张静止梯形 SVG，「选中」由一块共享的形变层实时画。
 * 动效：x / width / height 三个阻尼弹簧，切组时滑过去并轻微倾斜（lean）、先压后弹；
 * 底部基线恒定在标签栏高度上，下方卡片不会被顶动。
 */

/** 标签栏总高：形变层的底边钉在这里，卡片顶边也跟着它 */
export const TAB_HEADER_HEIGHT = 46
/** 未选中标签静止高度 */
export const TAB_INACTIVE_HEIGHT = 40
/** 选中标签静止高度 */
export const TAB_ACTIVE_HEIGHT = 44
const SLOPE = 15
const TOP_RADIUS = 12
const BOTTOM_RADIUS = 11
/** 选中形状向左多长的一截：左边是斜边，字的上半截会被吃掉留白，补 12px 左右才对称（用户 2026-11-18）。第一枚不补 —— 它要和卡片左沿垂直对齐。 */
const LEFT_EXTEND = 12

const round = (value: number) => Math.round(value * 100) / 100

export function inactiveTabPath(width: number, height: number, first: boolean): string {
  const w = Math.max(width, 56)
  const h = height
  const length = Math.hypot(SLOPE, h)
  const ux = SLOPE / length
  const uy = h / length
  const topRightX = w - BOTTOM_RADIUS - SLOPE
  const bottomRightX = w - BOTTOM_RADIUS
  const segments: string[] = [`M 0,${round(h)}`]

  if (first) {
    segments.push(
      `L 0,${TOP_RADIUS}`,
      `Q 0,0 ${TOP_RADIUS},0`,
      `L ${round(topRightX - TOP_RADIUS)},0`,
      `Q ${round(topRightX)},0 ${round(topRightX + ux * TOP_RADIUS)},${round(uy * TOP_RADIUS)}`,
      `L ${round(bottomRightX - ux * BOTTOM_RADIUS)},${round(h - uy * BOTTOM_RADIUS)}`,
      `Q ${round(bottomRightX)},${round(h)} ${round(w)},${round(h)}`,
      'Z',
    )
    return segments.join(' ')
  }

  const bottomLeftX = BOTTOM_RADIUS
  const topLeftX = BOTTOM_RADIUS + SLOPE
  segments.push(
    `Q ${round(bottomLeftX)},${round(h)} ${round(bottomLeftX + ux * BOTTOM_RADIUS)},${round(h - uy * BOTTOM_RADIUS)}`,
    `L ${round(topLeftX - ux * TOP_RADIUS)},${round(uy * TOP_RADIUS)}`,
    `Q ${round(topLeftX)},0 ${round(topLeftX + TOP_RADIUS)},0`,
    `L ${round(topRightX - TOP_RADIUS)},0`,
    `Q ${round(topRightX)},0 ${round(topRightX + ux * TOP_RADIUS)},${round(uy * TOP_RADIUS)}`,
    `L ${round(bottomRightX - ux * BOTTOM_RADIUS)},${round(h - uy * BOTTOM_RADIUS)}`,
    `Q ${round(bottomRightX)},${round(h)} ${round(w)},${round(h)}`,
    'Z',
  )
  return segments.join(' ')
}

export type MorphFrame = {
  x: number
  w: number
  h: number
  vx: number
}

/**
 * 选中标签的实时形变路径。
 *
 * - `x` 贴近 0（第一个分组）时左侧从「斜边 + 内凹小角」连续变成竖边，和卡片左上直角无缝；
 * - 水平速度 `vx` 会带来最多 ±6.5px 的顶部倾斜（液态惯性）；
 * - 高度 `h` 在 36 ~ 标签栏高度之间，底部基线 `y = headerHeight` 始终锁死。
 */
export function morphingTabPath(
  frame: MorphFrame,
  headerHeight: number = TAB_HEADER_HEIGHT,
): string {
  const height = Math.max(36, Math.min(headerHeight, frame.h))
  const topY = headerHeight - height
  const bottomY = headerHeight
  const leftMorph = Math.max(0, Math.min(1, frame.x / 18))
  const leftSlope = SLOPE * leftMorph
  const leftBottomRadius = BOTTOM_RADIUS * leftMorph
  const lean = Math.max(-6.5, Math.min(6.5, frame.vx * 0.0075))
  const left = frame.x - LEFT_EXTEND * leftMorph
  const right = frame.x + Math.max(frame.w, 64)

  const leftBottom = left + leftBottomRadius
  const leftTop = left + leftBottomRadius + leftSlope + lean
  const leftLength = Math.hypot(leftTop - leftBottom, height)
  const leftUx = leftLength > 0 ? (leftTop - leftBottom) / leftLength : 0
  const leftUy = leftLength > 0 ? height / leftLength : 1

  const rightBottom = right - BOTTOM_RADIUS
  const rightTop = right - BOTTOM_RADIUS - SLOPE + lean
  const rightLength = Math.hypot(rightBottom - rightTop, height)
  const rightUx = rightLength > 0 ? (rightBottom - rightTop) / rightLength : 0
  const rightUy = rightLength > 0 ? height / rightLength : 1

  const leftPart =
    leftMorph < 0.02
      ? `M ${round(left)},${bottomY} L ${round(left)},${round(topY + TOP_RADIUS)} Q ${round(left)},${round(topY)} ${round(left + TOP_RADIUS)},${round(topY)}`
      : `M ${round(left)},${bottomY} Q ${round(leftBottom)},${bottomY} ${round(leftBottom + leftUx * leftBottomRadius)},${round(bottomY - leftUy * leftBottomRadius)} L ${round(leftTop - leftUx * TOP_RADIUS)},${round(topY + leftUy * TOP_RADIUS)} Q ${round(leftTop)},${round(topY)} ${round(leftTop + TOP_RADIUS)},${round(topY)}`

  const rightPart = [
    `L ${round(rightTop - TOP_RADIUS)},${round(topY)}`,
    `Q ${round(rightTop)},${round(topY)} ${round(rightTop + rightUx * TOP_RADIUS)},${round(topY + rightUy * TOP_RADIUS)}`,
    `L ${round(rightBottom - rightUx * BOTTOM_RADIUS)},${round(bottomY - rightUy * BOTTOM_RADIUS)}`,
    `Q ${round(rightBottom)},${bottomY} ${round(right)},${bottomY}`,
    'Z',
  ].join(' ')

  return `${leftPart} ${rightPart}`
}

export type SpringValue = { value: number; velocity: number }

/** 单个阻尼弹簧：返回下一帧的位移与速度（显式欧拉，dt 已由调用方限幅）。 */
export function stepSpring(
  current: SpringValue,
  target: number,
  dt: number,
  stiffness: number,
  damping: number,
): SpringValue {
  const acceleration = -stiffness * (current.value - target) - damping * current.velocity
  const velocity = current.velocity + acceleration * dt
  return { value: current.value + velocity * dt, velocity }
}

export function isSpringSettled(current: SpringValue, target: number): boolean {
  return Math.abs(current.value - target) < 0.08 && Math.abs(current.velocity) < 0.4
}
