import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { Node as RFNode, Viewport } from '@xyflow/react'
import type { FlowNodeData } from './FlowNode'

/** d3-zoom 在 mousedown 就发 start：真实位移超过此阈值（屏幕 px）才切到手势快路径 */
export const PAN_ACTIVATE_PX = 4

export function useFlowGestureWindow({
  surfaceRef,
  nodes,
}: {
  surfaceRef: RefObject<HTMLDivElement | null>
  nodes: RFNode<FlowNodeData>[]
}) {
  const modeRef = useRef<'pan' | 'wheel' | null>(null)
  const pendingRef = useRef<Viewport | null>(null)
  const settleTimerRef = useRef<number | null>(null)

  const activate = useCallback(
    (mode: 'pan' | 'wheel') => {
      if (modeRef.current === mode) return
      modeRef.current = mode
      surfaceRef.current?.setAttribute('data-viewport-moving', 'true')
      surfaceRef.current?.setAttribute('data-viewport-mode', mode)
    },
    [surfaceRef],
  )

  const beginMove = useCallback(
    (event: MouseEvent | TouchEvent | null, viewport?: Viewport) => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      if (event?.type === 'wheel' || !viewport) {
        pendingRef.current = null
        activate(event?.type === 'wheel' ? 'wheel' : 'pan')
        return
      }
      // 单击空白：先挂起，不切任何层（否则点击也会换一套边渲染器）
      if (modeRef.current === null) pendingRef.current = { ...viewport }
    },
    [activate],
  )

  const move = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      const start = pendingRef.current
      if (!start || modeRef.current !== null) return
      const moved = Math.hypot(viewport.x - start.x, viewport.y - start.y)
      if (moved < PAN_ACTIVATE_PX && Math.abs(viewport.zoom - start.zoom) < 1e-4) return
      pendingRef.current = null
      activate('pan')
    },
    [activate],
  )

  const finishMove = useCallback(() => {
    settleTimerRef.current = null
    modeRef.current = null
    surfaceRef.current?.removeAttribute('data-viewport-moving')
    surfaceRef.current?.removeAttribute('data-viewport-mode')
  }, [surfaceRef])

  const endMove = useCallback(() => {
    pendingRef.current = null
    if (modeRef.current === null) return
    if (modeRef.current !== 'wheel') {
      finishMove()
      return
    }
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = window.setTimeout(() => {
      if (modeRef.current === 'wheel') finishMove()
    }, 180)
  }, [finishMove])

  useEffect(
    () => () => {
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    },
    [],
  )

  return { beginMove, move, endMove, renderedNodes: nodes }
}
