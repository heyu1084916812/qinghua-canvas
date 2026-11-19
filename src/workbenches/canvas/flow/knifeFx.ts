/**
 * 美工刀的**瞬态特效**（对账 #1159 第二轮）：刀光轨迹 + 火花。
 *
 * 为什么是模块级数组而不是 React state（用户给的工程注意事项第 5 条）：
 * 划动时每帧都在追加轨迹点、火花每帧都在掉落，这些是 60fps 的瞬时动画 ——
 * 放进组件 state 会把整棵面板/画布树按帧重渲染，一刀下去就掉帧。
 * 这里只做"数据 + 衰减"，绘制由 `KnifeFxLayer` 的独立 canvas 用 rAF 完成，零框架开销。
 */
export interface FxPoint {
  x: number
  y: number
}

interface TrailPoint extends FxPoint {
  /** 1 → 0 的剩余寿命 */
  life: number
}

interface Spark extends FxPoint {
  vx: number
  vy: number
  life: number
  /** 0~1 的随机大小系数 */
  size: number
}

const TRAIL_LIFE = 0.34
const SPARK_LIFE = 0.55
const MAX_TRAIL = 160
const MAX_SPARKS = 220

const trail: TrailPoint[] = []
const sparks: Spark[] = []

/** 划动经过的一个屏幕点（surface 局部坐标） */
export function pushTrail(x: number, y: number): void {
  trail.push({ x, y, life: 1 })
  if (trail.length > MAX_TRAIL) trail.shift()
}

/** 断线处的一簇火花 */
export function spawnSparks(x: number, y: number, count = 9): void {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const speed = 60 + Math.random() * 170
    sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      life: 1,
      size: 0.6 + Math.random() * 0.8,
    })
  }
  if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS)
}

/** 每帧推进一次：轨迹淡出、火花受重力下落并淡出 */
export function tickFx(dt: number): void {
  for (let i = trail.length - 1; i >= 0; i -= 1) {
    trail[i]!.life -= dt / TRAIL_LIFE
    if (trail[i]!.life <= 0) trail.splice(i, 1)
  }
  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const p = sparks[i]!
    p.life -= dt / SPARK_LIFE
    p.vy += 520 * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    if (p.life <= 0) sparks.splice(i, 1)
  }
}

/** 还有东西要画吗（rAF 循环据此决定要不要继续跑） */
export function hasFx(): boolean {
  return trail.length > 0 || sparks.length > 0
}

export function clearFx(): void {
  trail.length = 0
  sparks.length = 0
}

export function fxSnapshot(): { trail: readonly TrailPoint[]; sparks: readonly Spark[] } {
  return { trail, sparks }
}