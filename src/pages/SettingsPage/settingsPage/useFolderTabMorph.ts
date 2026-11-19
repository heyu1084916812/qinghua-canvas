import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  TAB_ACTIVE_HEIGHT,
  TAB_HEADER_HEIGHT,
  isSpringSettled,
  morphingTabPath,
  stepSpring,
  type MorphFrame,
  type SpringValue,
} from './folderTabGeometry'
import { revealFolderTab } from './folderTabVisibility'

type MorphSpringState = {
  x: SpringValue
  w: SpringValue
  h: SpringValue
  targetX: number
  targetW: number
  targetH: number
  initialized: boolean
  raf: number
  last: number
}

const createSpringState = (): MorphSpringState => ({
  x: { value: 0, velocity: 0 },
  w: { value: 0, velocity: 0 },
  h: { value: TAB_ACTIVE_HEIGHT, velocity: 0 },
  targetX: 0,
  targetW: 0,
  targetH: TAB_ACTIVE_HEIGHT,
  initialized: false,
  raf: 0,
  last: 0,
})

/**
 * 文件夹标签形变：量真实宽高、逐帧绘制 x/w/h 弹簧，并在切组时给向下的初速度做回弹。
 * 组件只负责渲染结构；这里拿到的 ref 直接挂到 tabs 容器与形变层上。
 */
export function useFolderTabMorph(activeGroupId: string | null | undefined) {
  const tabRefs = useRef(new Map<string, HTMLDivElement>())
  const tabsHostRef = useRef<HTMLDivElement | null>(null)
  const morphSvgRef = useRef<SVGSVGElement | null>(null)
  const morphPathRef = useRef<SVGPathElement | null>(null)
  const springRef = useRef<MorphSpringState>(createSpringState())
  const previousActiveRef = useRef<string | null>(null)
  /* 每枚标签量到的真实像素宽高：静止梯形的 SVG viewBox 按它建，避免缩放把圆角拉变形。 */
  const [tabSizes, setTabSizes] = useState<Record<string, { w: number; h: number }>>({})

  const paintMorph = useCallback((frame: MorphFrame) => {
    const svg = morphSvgRef.current
    const path = morphPathRef.current
    const host = tabsHostRef.current
    if (!svg || !path || !host || !svg.style) return
    const width = Math.max(host.scrollWidth, host.clientWidth)
    svg.style.width = `${width}px`
    svg.style.height = `${TAB_HEADER_HEIGHT}px`
    svg.setAttribute('viewBox', `0 0 ${width} ${TAB_HEADER_HEIGHT}`)
    path.setAttribute('d', morphingTabPath(frame, TAB_HEADER_HEIGHT))
  }, [])

  const runSpringFrame = useCallback(
    (now: number) => {
      const spring = springRef.current
      if (!spring.last) spring.last = now
      const dt = Math.min(0.032, (now - spring.last) / 1000)
      spring.last = now
      spring.x = stepSpring(spring.x, spring.targetX, dt, 340, 22)
      spring.w = stepSpring(spring.w, spring.targetW, dt, 340, 22)
      spring.h = stepSpring(spring.h, spring.targetH, dt, 420, 21)
      paintMorph({
        x: spring.x.value,
        w: spring.w.value,
        h: spring.h.value,
        vx: spring.x.velocity,
      })
      const settled =
        isSpringSettled(spring.x, spring.targetX) &&
        isSpringSettled(spring.w, spring.targetW) &&
        isSpringSettled(spring.h, spring.targetH)
      if (settled) {
        spring.x = { value: spring.targetX, velocity: 0 }
        spring.w = { value: spring.targetW, velocity: 0 }
        spring.h = { value: spring.targetH, velocity: 0 }
        paintMorph({ x: spring.targetX, w: spring.targetW, h: spring.targetH, vx: 0 })
        spring.raf = 0
        spring.last = 0
        return
      }
      spring.raf = window.requestAnimationFrame(runSpringFrame)
    },
    [paintMorph],
  )

  const syncMorphTarget = useCallback(
    (bounce: boolean) => {
      /* node / SSR 里没有 window，也就没有 rAF 与布局，直接跳过动画（测试用静态渲染跑） */
      if (typeof window === 'undefined') return
      const tab = activeGroupId ? tabRefs.current.get(activeGroupId) : null
      const spring = springRef.current
      if (!tab) return
      const x = tab.offsetLeft
      const w = tab.offsetWidth
      revealFolderTab(tabsHostRef.current, tab)
      const unchanged =
        spring.initialized &&
        !bounce &&
        !spring.raf &&
        Math.abs(spring.targetX - x) < 0.5 &&
        Math.abs(spring.targetW - w) < 0.5
      if (unchanged) {
        paintMorph({ x: spring.x.value, w: spring.w.value, h: spring.h.value, vx: 0 })
        return
      }
      if (!spring.initialized) {
        spring.x = { value: x, velocity: 0 }
        spring.w = { value: w, velocity: 0 }
        spring.h = { value: TAB_ACTIVE_HEIGHT, velocity: 0 }
        spring.initialized = true
      }
      spring.targetX = x
      spring.targetW = w
      spring.targetH = TAB_ACTIVE_HEIGHT
      /* 切组时先给一个向下的初速度：形状滑过去时先微压再弹回 */
      if (bounce) spring.h.velocity = -68
      paintMorph({ x: spring.x.value, w: spring.w.value, h: spring.h.value, vx: spring.x.velocity })
      if (!spring.raf) {
        spring.last = 0
        spring.raf = window.requestAnimationFrame(runSpringFrame)
      }
    },
    [activeGroupId, paintMorph, runSpringFrame],
  )

  /* 量每枚标签的真实宽高：改名 / 文字变长时跟着重量 */
  useLayoutEffect(() => {
    const next: Record<string, { w: number; h: number }> = {}
    let changed = false
    tabRefs.current.forEach((element, id) => {
      const w = Math.round(element.offsetWidth)
      const h = Math.round(element.offsetHeight)
      if (!w || !h) return
      next[id] = { w, h }
      const previous = tabSizes[id]
      if (!previous || previous.w !== w || previous.h !== h) changed = true
    })
    if (changed) setTabSizes(next)
  })

  useLayoutEffect(() => {
    const activeId = activeGroupId ?? null
    const bounce = previousActiveRef.current !== null && previousActiveRef.current !== activeId
    previousActiveRef.current = activeId
    syncMorphTarget(bounce)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => syncMorphTarget(false)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [syncMorphTarget])

  useEffect(
    () => () => {
      if (typeof window === 'undefined') return
      const spring = springRef.current
      if (spring.raf) window.cancelAnimationFrame(spring.raf)
      /* StrictMode 会 mount → 卸载 → 再 mount：取消后必须把 id 和初始化标记一起清掉，
         否则第二次挂载看到 raf 非 0 就再也不启动动画了。 */
      spring.raf = 0
      spring.last = 0
      spring.initialized = false
    },
    [],
  )

  return { tabRefs, tabsHostRef, morphSvgRef, morphPathRef, tabSizes }
}
