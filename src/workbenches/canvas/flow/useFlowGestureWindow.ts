import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { Node as RFNode } from '@xyflow/react'
import type { FlowNodeData } from './FlowNode'

export function useFlowGestureWindow({
  surfaceRef,
  nodes,
}: {
  surfaceRef: RefObject<HTMLDivElement | null>
  nodes: RFNode<FlowNodeData>[]
}) {
  const modeRef = useRef<'pan' | 'wheel' | null>(null)
  const settleTimerRef = useRef<number | null>(null)

  const beginMove = useCallback(
    (event: MouseEvent | TouchEvent | null) => {
      const mode = event?.type === 'wheel' ? 'wheel' : 'pan'
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      if (modeRef.current === mode) return
      modeRef.current = mode
      surfaceRef.current?.setAttribute('data-viewport-moving', 'true')
      surfaceRef.current?.setAttribute('data-viewport-mode', mode)
    },
    [surfaceRef],
  )

  const finishMove = useCallback(() => {
    settleTimerRef.current = null
    modeRef.current = null
    surfaceRef.current?.removeAttribute('data-viewport-moving')
    surfaceRef.current?.removeAttribute('data-viewport-mode')
  }, [surfaceRef])

  const endMove = useCallback(() => {
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

  return { beginMove, endMove, renderedNodes: nodes }
}
