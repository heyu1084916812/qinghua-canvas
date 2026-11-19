import { useEffect, useRef } from 'react'
import styles from './KnifeFxLayer.module.css'
import { fxSnapshot, hasFx, tickFx } from './knifeFx'

/**
 * 刀光与火花的**独立绘制层**（对账 #1159 第二轮，用户给的注意事项第 5 条）。
 *
 * 一块铺满画布的 `<canvas>`（`pointer-events: none`）+ 自己的 rAF 循环：
 * 高频瞬态（轨迹淡出、火花重力）不经过 React，组件树一帧都不重渲染。
 * 颜色只从主题令牌读（`--text-1` / `--warn`），所以深浅主题都跟着走。
 */
export function KnifeFxLayer({ surfaceEl, active }: { surfaceEl: () => HTMLElement | null; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    let raf = 0
    let last = performance.now()
    let width = 0
    let height = 0

    const resize = () => {
      const host = surfaceEl()
      const nextW = host?.clientWidth ?? 0
      const nextH = host?.clientHeight ?? 0
      if (!nextW || !nextH) return
      if (nextW === width && nextH === height) return
      width = nextW
      height = nextH
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      const { trail, sparks } = fxSnapshot()
      if (trail.length > 1) {
        const root = getComputedStyle(document.documentElement)
        const ink = root.getPropertyValue('--text-1').trim() || 'currentColor'
        /* 两层：宽的做刀光晕，细的做刀锋 —— 都按每个点的剩余寿命单独给透明度 */
        ctx.lineCap = 'round'
        for (let i = 1; i < trail.length; i += 1) {
          const a = trail[i - 1]!
          const b = trail[i]!
          const alpha = Math.max(0, Math.min(a.life, b.life))
          if (alpha <= 0) continue
          ctx.strokeStyle = ink
          ctx.globalAlpha = alpha * 0.18
          ctx.lineWidth = 9
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
          ctx.globalAlpha = alpha * 0.8
          ctx.lineWidth = 1.8
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }
      if (sparks.length > 0) {
        const root = getComputedStyle(document.documentElement)
        const spark = root.getPropertyValue('--warn').trim() || 'currentColor'
        ctx.fillStyle = spark
        for (const p of sparks) {
          ctx.globalAlpha = Math.max(0, p.life) * 0.9
          ctx.beginPath()
          ctx.arc(p.x, p.y, 1.1 + p.size * 1.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      resize()
      tickFx(dt)
      draw()
      raf = active || hasFx() ? window.requestAnimationFrame(loop) : 0
    }

    resize()
    raf = window.requestAnimationFrame(loop)
    const host = surfaceEl()
    const observer = host ? new ResizeObserver(() => resize()) : null
    if (host && observer) observer.observe(host)
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  }, [active, surfaceEl])

  return <canvas ref={ref} className={styles.layer} data-knife-fx aria-hidden />
}