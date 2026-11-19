import { useCallback, useEffect, useRef, useState } from 'react'
import { cutPolylineAt, segmentBox, boxesOverlap, segmentHitsPolyline, type ScreenPoint } from './edgeCutGeometry'
import type { ActiveEdgeCut } from './FlowEdgeCutLayer'
import { isKnifeOn, subscribeKnife } from '../../../features/canvas/knifeMode'
import { pushTrail, spawnSparks } from './knifeFx'

/** RF 普通/粗略边均由一个 M + C 构成。复用实际绘制的控制点，不重复调用昂贵的 SVG 长度 API。 */
function snapshotEdges(surface: HTMLElement, rect: DOMRect) {
  return Array.from(surface.querySelectorAll<SVGPathElement>('[data-edge]')).flatMap(path => {
    const id = path.dataset.edge, d = path.getAttribute('d') ?? '', matrix = path.getScreenCTM()
    if (!id || !matrix) return []
    const nums = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi)?.map(Number)
    const pts: ScreenPoint[] = []
    const add = (x: number, y: number) => pts.push({ x: matrix.a*x + matrix.c*y + matrix.e - rect.left, y: matrix.b*x + matrix.d*y + matrix.f - rect.top })
    if (nums?.length === 8 && /^M[^a-z]*C/i.test(d.replace(/e[-+]?\d+/gi,''))) {
      for (let i=0;i<=20;i++) {
        const t=i/20, u=1-t, blend=(a:number,b:number,c:number,d:number)=>u*u*u*a+3*u*u*t*b+3*u*t*t*c+t*t*t*d
        add(blend(nums[0]!,nums[2]!,nums[4]!,nums[6]!),blend(nums[1]!,nums[3]!,nums[5]!,nums[7]!))
      }
    } else {
      const len=path.getTotalLength(); if (!(len>0)) return []
      for(let i=0;i<=20;i++){const p=path.getPointAtLength(i*len/20);add(p.x,p.y)}
    }
    const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y)
    return [{ id, points:pts, box:{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)} }]
  })
}

interface SliceSession {
  edges: ReturnType<typeof snapshotEdges>
  /** 这一次挥刀共用一个 undo key：8 条线也只算一条历史 */
  planId: string
  last: ScreenPoint | null
  cut: Set<string>
}

/**
 * 「按住空格挥刀」的整套交互（对账 #1159 第二轮）。
 *
 * 三条硬要求（用户给的工程注意事项）：
 * 1. **防漏切**：上一帧 → 这一帧的鼠标轨迹当成线段，与连线逐段求交（点检测会漏）；
 * 2. **防掉帧**：按下时冻结可见边的折线与包围盒，每次移动只在内存中检测；
 * 3. **一次挥刀 = 一条 Undo**：`pointerdown` 建一个 `planId`，挥刀过程中所有删除都用它
 *    派发（`multi-step` 事务），松手即合并成一条历史，不用连按 8 次 Ctrl+Z。
 *
 * 断线残影由 `FlowEdgeCutLayer` 播（两段分开淡出），刀光与火花进 `knifeFx` 的 canvas 层。
 */
export function useEdgeCut(options: {
  surfaceEl: () => HTMLElement | null
  /** 一次挥刀内可能删多条；调用方按 planId 把它们合成一条 Undo */
  removeEdges: (ids: readonly string[], planId: string) => void
}): {
  cuts: ActiveEdgeCut[]
  begin: (clientX: number, clientY: number) => void
  move: (clientX: number, clientY: number) => void
  end: () => void
} {
  const { surfaceEl, removeEdges } = options
  const [cuts, setCuts] = useState<ActiveEdgeCut[]>([])
  const sessionRef = useRef<SliceSession | null>(null)

  const begin = useCallback(
    (clientX: number, clientY: number) => {
      const surface=surfaceEl(); if (!surface) return
      const rect=surface.getBoundingClientRect(), local={x:clientX-rect.left,y:clientY-rect.top}
      sessionRef.current = { edges:snapshotEdges(surface,rect), planId: `knife:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, last: local, cut: new Set() }
      pushTrail(local.x, local.y)
    },
    [surfaceEl],
  )

  const move = useCallback(
    (clientX: number, clientY: number) => {
      const session = sessionRef.current
      const surface = surfaceEl()
      if (!session || !surface) return
      const rect = surface.getBoundingClientRect()
      const to: ScreenPoint = { x: clientX - rect.left, y: clientY - rect.top }
      const from = session.last ?? to
      session.last = to
      pushTrail(to.x, to.y)

      const sweep = segmentBox(from, to, 8)
      const hitIds: string[] = []
      const spawned: ActiveEdgeCut[] = []
      for (const {id, points, box} of session.edges) {
        if (session.cut.has(id) || !boxesOverlap(sweep,box)) continue
        const hit = segmentHitsPolyline(points, from, to)
        if (!hit) continue
        session.cut.add(id)
        const halves = cutPolylineAt(points, hit.point)
        if (halves) spawned.push({ id, top: halves.top, bottom: halves.bottom, key: `${id}:${Date.now()}` })
        spawnSparks(hit.point.x, hit.point.y)
        hitIds.push(id)
      }

      if (hitIds.length === 0) return
      if (spawned.length > 0) {
        setCuts((prev) => [...prev, ...spawned])
        window.setTimeout(() => {
          const keys = new Set(spawned.map((c) => c.key))
          setCuts((prev) => prev.filter((c) => !keys.has(c.key)))
        }, 320)
      }
      removeEdges(hitIds, session.planId)
    },
    [removeEdges, surfaceEl],
  )

  const end = useCallback(() => {
    sessionRef.current = null
  }, [])

  // 中断的是这一刀，不是已提交的切线；重新启用工具必须等待新的 pointerdown。
  useEffect(() => {
    const unsubscribe = subscribeKnife(() => { if (!isKnifeOn()) end() })
    const hide = () => { if (document.hidden) end() }
    const events = ['blur', 'pointercancel', 'pointerup'] as const
    for (const event of events) window.addEventListener(event, end, true)
    document.addEventListener('visibilitychange', hide)
    return () => {
      unsubscribe()
      for (const event of events) window.removeEventListener(event, end, true)
      document.removeEventListener('visibilitychange', hide)
    }
  }, [end])

  return { cuts, begin, move, end }
}