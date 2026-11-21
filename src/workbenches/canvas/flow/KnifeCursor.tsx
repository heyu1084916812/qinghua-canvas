import { useEffect, useLayoutEffect, useRef } from 'react'
import { Slice } from '../../../ui/icon'
import styles from './FlowEdgeCutLayer.module.css'

/*
 * Lucide `Slice` 的 sharp point 在 24 格视图里是 (2,20)。
 * 图标显示为 20px 时约为 (1.67,16.67)，取整后把刀尖锚到指针上。
 */
const KNIFE_TIP_OFFSET = { x: 2, y: 17 } as const

/** Keep the visible blade tip on the pointer without scaling or frame-based lag. */
export function knifeCursorTransform(clientX: number, clientY: number): string {
  return `translate3d(${clientX - KNIFE_TIP_OFFSET.x}px, ${clientY - KNIFE_TIP_OFFSET.y}px, 0)`
}

/**
 * 跟着指针走的美工刀（对账 #1159；用户 2026-11-19 第二轮：**去掉外面那个圆**）。
 *
 * 性能要点（用户实测"很卡"的直接原因）：
 * 上一版把指针坐标放进 React state，挂在画布根上 —— 每次 `pointermove` 都让
 * 1000 行的 `FlowSurface` 重渲染一次，鼠标一动就掉帧、点下去还容易错过目标。
 * 现在坐标**完全不进 React**：这个小组件自己在 window 上听标准指针事件，
 * 每个事件直接写 `transform: translate3d(...)`（合成层，不触发布局）。
 * 不再等 rAF；也不听 `pointerrawupdate`，因为原始指针采样会比系统光标先投递，
 * 自绘刀尖会看起来比鼠标快。除了事件节奏，锚点必须是刀尖而不是图标左上角，
 * 否则整把刀会恒定偏移，水平/垂直移动时同样会被看成“抢在鼠标前面”。
 */
export function KnifeCursor({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const point = useRef({ x: -200, y: -200, seen: false })
  const activeRef = useRef(active)
  activeRef.current = active

  const paint = () => {
    const el = ref.current
    if (!el || !point.current.seen) return
    el.style.transform = knifeCursorTransform(point.current.x, point.current.y)
  }

  useLayoutEffect(() => {
    if (active) paint()
  }, [active])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      point.current = { x: event.clientX, y: event.clientY, seen: true }
      if (activeRef.current) paint()
    }
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    return () => {
      window.removeEventListener('pointermove', move, { capture: true })
    }
  }, [])

  if (!active) return null
  return (
    <div ref={ref} className={styles.knifeCursor} data-knife-cursor aria-hidden>
      <Slice size={20} />
    </div>
  )
}
