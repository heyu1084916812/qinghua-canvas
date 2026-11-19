import { useCallback, useState } from 'react'
import { cutPolylineAt, distanceToPolyline, type ScreenPoint } from './edgeCutGeometry'
import type { ActiveEdgeCut } from './FlowEdgeCutLayer'

/**
 * 「切一刀」的全部逻辑（对账 #1159）：找最近的连线 → 切成两段 → 播分离淡出 → 播完才删边。
 *
 * 为什么从 `FlowSurface` 里抽出来：表面那个文件已经顶着 999 行的治理预算，
 * 而这段是**自成一体的几何 + 时序**，跟表面的渲染树没有耦合，抽出来反而更好读。
 *
 * ⚠️ 踩过的坑（两次都在这段里）：
 * 1. **不能在 pointerdown 那一拍读 DOM**：实测那一刻 React Flow 正在为这次按下重渲染，
 *    `.react-flow__edges` 的 childElementCount = 0、`[data-edge]` 一个都没有，要过一两帧才回来
 *    ⇒ 这里**逐帧重试**（最多 ~200ms），有边才量。
 * 2. **不能用 `elementFromPoint` 找命中区**：粗视口（`FlowCoarseEdge`）没有加宽命中区，
 *    会出现"近处能切、远处切不动" ⇒ 改成按**屏幕折线距离**找（阈值 14px）。
 */
export function useEdgeCut(options: {
  surfaceEl: () => HTMLElement | null
  removeEdge: (id: string) => void
}): { edgeCut: ActiveEdgeCut | null; cutAt: (clientX: number, clientY: number) => void } {
  const { surfaceEl, removeEdge } = options
  const [edgeCut, setEdgeCut] = useState<ActiveEdgeCut | null>(null)

  const cutAt = useCallback(
    (clientX: number, clientY: number) => {
      const surface = surfaceEl()
      if (!surface) return
      const MAX_FRAMES = 12
      const attempt = (frame: number) => {
        const paths = Array.from(document.querySelectorAll<SVGPathElement>('[data-edge]'))
        if (paths.length === 0) {
          if (frame < MAX_FRAMES) window.requestAnimationFrame(() => attempt(frame + 1))
          return
        }
        const rect = surface.getBoundingClientRect()
        const pointer = { x: clientX - rect.left, y: clientY - rect.top }
        let picked: { id: string; points: ScreenPoint[] } | null = null
        let bestDistance = 14
        for (const path of paths) {
          const ctm = path.getScreenCTM()
          if (!ctm) continue
          const total = path.getTotalLength()
          if (!(total > 0)) continue
          const steps = 40
          const points: ScreenPoint[] = []
          for (let i = 0; i <= steps; i += 1) {
            const at = path.getPointAtLength((total * i) / steps).matrixTransform(ctm)
            points.push({ x: at.x - rect.left, y: at.y - rect.top })
          }
          const distance = distanceToPolyline(points, pointer)
          if (distance > bestDistance) continue
          bestDistance = distance
          picked = { id: path.getAttribute('data-edge') ?? '', points }
        }
        if (!picked) return
        const id = picked.id
        const halves = cutPolylineAt(picked.points, pointer)
        if (!id || !halves) return
        setEdgeCut({ id, top: halves.top, bottom: halves.bottom })
        const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-cut').trim()
        const ms = Number.parseFloat(raw)
        window.setTimeout(
          () => {
            removeEdge(id)
            setEdgeCut(null)
          },
          Number.isFinite(ms) ? ms : 260,
        )
      }
      attempt(0)
    },
    [removeEdge, surfaceEl],
  )

  return { edgeCut, cutAt }
}