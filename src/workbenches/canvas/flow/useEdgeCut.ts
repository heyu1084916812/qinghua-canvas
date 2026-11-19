import { useCallback, useEffect, useRef } from 'react'
import { cutPolylineAt, segmentBox, boxesOverlap, segmentHitsPolyline, type ScreenPoint } from './edgeCutGeometry'
import type { ActiveEdgeCut, CutPreview } from './FlowEdgeCutLayer'
import { isKnifeOn, subscribeKnife } from '../../../features/canvas/knifeMode'
import { pushTrail, spawnSparks } from './knifeFx'

import { snapshotEdges } from './knifeSnapshot'

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
 * 3. **一次挥刀 = 一条 Undo**：`pointerdown` 建一个 `planId`，挥刀时只预览，结束时一次提交命中集合，不用连按 8 次 Ctrl+Z。
 *
 * 断线残影由 `FlowEdgeCutLayer` 播（两段分开淡出），刀光与火花进 `knifeFx` 的 canvas 层。
 */
export function useEdgeCut(options: {
  surfaceEl: () => HTMLElement | null
  /** 一次挥刀内可能删多条；调用方按 planId 把它们合成一条 Undo */
  removeEdges: (ids: readonly string[], planId: string) => void
}): {
  preview: React.RefObject<CutPreview>
  begin: (clientX: number, clientY: number) => void
  move: (clientX: number, clientY: number) => void
  end: () => void
} {
  const { surfaceEl, removeEdges } = options
  const preview = useRef<CutPreview>(null)
  const removeRef = useRef(removeEdges)
  removeRef.current = removeEdges
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
      const spawned: ActiveEdgeCut[] = []
      for (const {id, path, points, box} of session.edges) {
        if (session.cut.has(id) || !boxesOverlap(sweep,box)) continue
        const hit = segmentHitsPolyline(points, from, to)
        if (!hit) continue
        session.cut.add(id)
        const halves = cutPolylineAt(points, hit.point)
        if (halves) spawned.push({ id, top: halves.top, bottom: halves.bottom, key: `${id}:${Date.now()}` })
        spawnSparks(hit.point.x, hit.point.y)
        path.setAttribute('data-knife-pending','')
      }

      if (spawned.length) preview.current?.show(spawned)
    },
    [surfaceEl],
  )

  const end = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session?.cut.size) return
    for (const {path,id} of session.edges) if (session.cut.has(id)) path.removeAttribute('data-knife-pending')
    removeRef.current([...session.cut],session.planId)
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

  return { preview, begin, move, end }
}