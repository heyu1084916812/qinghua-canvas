import { useCallback, useRef, useState } from 'react'
import { cutPolylineAt, segmentBox, boxesOverlap, segmentHitsPolyline, type ScreenPoint } from './edgeCutGeometry'
import type { ActiveEdgeCut } from './FlowEdgeCutLayer'
import { pushTrail, spawnSparks } from './knifeFx'

interface SliceSession {
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
 * 2. **防掉帧**：先用 DOM 的 `getBoundingClientRect()` 做包围盒粗筛，命中才把这条线
 *    采样成 24 段折线细算 —— 几百条线时每帧只细算极少数；
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

  const localOf = (clientX: number, clientY: number): ScreenPoint | null => {
    const surface = surfaceEl()
    if (!surface) return null
    const rect = surface.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }

  const begin = useCallback(
    (clientX: number, clientY: number) => {
      const local = localOf(clientX, clientY)
      if (!local) return
      sessionRef.current = { planId: `knife:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`, last: local, cut: new Set() }
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

      /* 粗筛用的包围盒在**屏幕坐标**里算（与 getBoundingClientRect 同一坐标系） */
      const screenFrom = { x: from.x + rect.left, y: from.y + rect.top }
      const screenTo = { x: to.x + rect.left, y: to.y + rect.top }
      const sweep = segmentBox(screenFrom, screenTo, 8)

      const hitIds: string[] = []
      const spawned: ActiveEdgeCut[] = []
      for (const path of Array.from(document.querySelectorAll<SVGPathElement>('[data-edge]'))) {
        const id = path.getAttribute('data-edge') ?? ''
        if (!id || session.cut.has(id)) continue
        const box = path.getBoundingClientRect()
        if (
          !boxesOverlap(sweep, {
            minX: box.left - 6,
            minY: box.top - 6,
            maxX: box.right + 6,
            maxY: box.bottom + 6,
          })
        ) {
          continue
        }
        const ctm = path.getScreenCTM()
        const total = path.getTotalLength()
        if (!ctm || !(total > 0)) continue
        const steps = 24
        const points: ScreenPoint[] = []
        for (let i = 0; i <= steps; i += 1) {
          const at = path.getPointAtLength((total * i) / steps).matrixTransform(ctm)
          points.push({ x: at.x - rect.left, y: at.y - rect.top })
        }
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

  return { cuts, begin, move, end }
}