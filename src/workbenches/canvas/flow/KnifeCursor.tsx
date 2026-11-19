import { useEffect, useRef } from 'react'
import { Slice } from '../../../ui/icon'
import styles from './FlowEdgeCutLayer.module.css'

/**
 * 跟着指针走的美工刀（对账 #1159；用户 2026-11-19 第二轮：**去掉外面那个圆**）。
 *
 * 性能要点（用户实测"很卡"的直接原因）：
 * 上一版把指针坐标放进 React state，挂在画布根上 —— 每次 `pointermove` 都让
 * 1000 行的 `FlowSurface` 重渲染一次，鼠标一动就掉帧、点下去还容易错过目标。
 * 现在坐标**完全不进 React**：这个小组件自己在 window 上听 `pointermove`，
 * 用 rAF 合并后用 `transform: translate3d(...)` 直接写样式（合成层，不触发布局）。
 */
export function KnifeCursor({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    let frame = 0
    let x = -200
    let y = -200
    const paint = () => {
      frame = 0
      const el = ref.current
      if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
    const move = (e: PointerEvent) => {
      /* +4px 让刀尖落在指针位置上（视觉热点），而不是让图标压住指针 */
      x = e.clientX + 4
      y = e.clientY + 4
      if (!frame) frame = window.requestAnimationFrame(paint)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      window.removeEventListener('pointermove', move)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [active])

  if (!active) return null
  return (
    <div ref={ref} className={styles.knifeCursor} data-knife-cursor aria-hidden>
      <Slice size={20} />
    </div>
  )
}