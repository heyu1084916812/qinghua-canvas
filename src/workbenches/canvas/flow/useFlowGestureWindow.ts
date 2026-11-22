import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Node as RFNode } from '@xyflow/react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { FlowNodeData } from './FlowNode'
import { nodesInGestureWindow } from './flowGestureWindow'

export function useFlowGestureWindow({
  store,
  surfaceRef,
  nodes,
}: {
  store: CanvasStore
  surfaceRef: RefObject<HTMLDivElement | null>
  nodes: RFNode<FlowNodeData>[]
}) {
  const [moving, setMoving] = useState(false)
  const [nodeIds, setNodeIds] = useState<ReadonlySet<string> | null>(null)
  const modeRef = useRef<'pan' | 'wheel' | null>(null)
  const settleTimerRef = useRef<number | null>(null)
  const renderedNodes = useMemo(
    () => (nodeIds ? nodes.filter((node) => nodeIds.has(node.id)) : nodes),
    [nodeIds, nodes],
  )

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
      setNodeIds(
        new Set(
          nodesInGestureWindow(nodes, store.getViewport(), store.getSurfaceSize()).map(
            (node) => node.id,
          ),
        ),
      )
      setMoving(true)
    },
    [nodes, store, surfaceRef],
  )

  const finishMove = useCallback(() => {
    settleTimerRef.current = null
    modeRef.current = null
    surfaceRef.current?.removeAttribute('data-viewport-moving')
    setNodeIds(null)
    setMoving(false)
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

  return { beginMove, endMove, moving, renderedNodes }
}
