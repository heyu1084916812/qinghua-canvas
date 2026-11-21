import { useEffect, useLayoutEffect, useRef } from 'react'
import { Slice } from '../../../ui/icon'
import styles from './FlowEdgeCutLayer.module.css'

const POINTER_EVENTS = ['pointerrawupdate', 'pointermove'] as const

/** Keep the blade tip on the pointer without scaling or frame-based lag. */
export function knifeCursorTransform(clientX: number, clientY: number): string {
  return `translate3d(${clientX - 2}px, ${clientY - 2}px, 0)`
}

/**
 * 跟着指针走的美工刀（对账 #1159；用户 2026-11-19 第二轮：**去掉外面那个圆**）。
 *
 * 性能要点（用户实测"很卡"的直接原因）：
 * 上一版把指针坐标放进 React state，挂在画布根上 —— 每次 `pointermove` 都让
 * 1000 行的 `FlowSurface` 重渲染一次，鼠标一动就掉帧、点下去还容易错过目标。
 * 现在坐标**完全不进 React**：这个小组件自己在 window 上听原始指针事件，
 * 每个事件直接写 `transform: translate3d(...)`（合成层，不触发布局）。
 * 不再等 rAF：上一版每次都被合到下一帧，用户会觉得刀比鼠标慢半拍。
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
    const move: EventListener = (event) => {
      const e = event as PointerEvent
      point.current = { x: e.clientX, y: e.clientY, seen: true }
      if (activeRef.current) paint()
    }
    for (const type of POINTER_EVENTS) {
      window.addEventListener(type, move, { capture: true, passive: true })
    }
    return () => {
      for (const type of POINTER_EVENTS) {
        window.removeEventListener(type, move, { capture: true })
      }
    }
  }, [])

  if (!active) return null
  return (
    <div ref={ref} className={styles.knifeCursor} data-knife-cursor aria-hidden>
      <Slice size={20} />
    </div>
  )
}
