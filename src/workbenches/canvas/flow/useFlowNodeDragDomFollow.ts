import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { FlowDragAnchor } from './flowSurfaceChangeCoordinator'
import {
  captureFlowDragEdgePaths,
  writeFlowNodeDragDomPositions,
  writeFlowDragEdgePaths,
  type FlowDragEdgePathSnapshot,
} from './flowDragDomFollower'

interface DirectDragState {
  anchor: FlowDragAnchor
  movingIds: Set<string>
  edges: FlowDragEdgePathSnapshot[]
  lastClientX: number
  lastClientY: number
  moved: boolean
  frame: number | null
}

/**
 * Keeps pointer-followed node transforms and connected edge paths ahead of
 * React Flow's controlled-store commit. The store settles once on drag end.
 */
export function useFlowNodeDragDomFollow({
  store,
  surfaceRef,
}: {
  store: CanvasStore
  surfaceRef: RefObject<HTMLDivElement | null>
}) {
  const stateRef = useRef<DirectDragState | null>(null)

  const captureEdges = useCallback(
    (movingIds: Set<string>) => {
      const graph = store.getSnapshot()
      const edgeIds = new Set(
        graph.edges
          .filter(
            (edge) => movingIds.has(edge.source) || movingIds.has(edge.target),
          )
          .map((edge) => edge.id),
      )
      return captureFlowDragEdgePaths(document, movingIds, edgeIds)
    },
    [store],
  )

  const begin = useCallback(
    (
      anchor: FlowDragAnchor,
      clientX: number,
      clientY: number,
      moved = false,
    ) => {
      const movingIds = new Set(anchor.nodes.keys())
      stateRef.current = {
        anchor,
        movingIds,
        edges: captureEdges(movingIds),
        lastClientX: clientX,
        lastClientY: clientY,
        moved,
        frame: null,
      }
      surfaceRef.current?.setAttribute('data-direct-drag', 'true')
    },
    [captureEdges, surfaceRef],
  )

  const move = useCallback((clientX: number, clientY: number) => {
    const state = stateRef.current
    if (!state) return
    const screenDx = clientX - state.anchor.clientX
    const screenDy = clientY - state.anchor.clientY
    state.lastClientX = clientX
    state.lastClientY = clientY
    if (!state.moved && Math.hypot(screenDx, screenDy) < 2) return
    state.moved = true
    const dx = screenDx / (state.anchor.zoom || 1)
    const dy = screenDy / (state.anchor.zoom || 1)
    const starts = [...state.anchor.nodes].map(([id, position]) => ({
      id,
      x: position.x,
      y: position.y,
    }))
    const write = () => {
      writeFlowNodeDragDomPositions(document, starts, dx, dy)
      writeFlowDragEdgePaths(state.edges, state.movingIds, dx, dy)
    }
    write()
    if (state.frame) cancelAnimationFrame(state.frame)
    state.frame = requestAnimationFrame(() => {
      if (stateRef.current !== state) return
      state.frame = null
      write()
    })
  }, [])

  const isActive = useCallback(() => stateRef.current !== null, [])
  const moved = useCallback(() => stateRef.current?.moved === true, [])
  const lastPointer = useCallback(() => {
    const state = stateRef.current
    return state
      ? { clientX: state.lastClientX, clientY: state.lastClientY }
      : null
  }, [])

  useEffect(() => {
    let clearTimer: number | null = null
    const clear = () => {
      const state = stateRef.current
      if (state?.frame) cancelAnimationFrame(state.frame)
      stateRef.current = null
      surfaceRef.current?.removeAttribute('data-direct-drag')
    }
    const clearAfterDragEnd = () => {
      if (clearTimer !== null) window.clearTimeout(clearTimer)
      clearTimer = window.setTimeout(() => {
        clearTimer = null
        clear()
      }, 0)
    }
    const onMove = (event: PointerEvent) => {
      move(event.clientX, event.clientY)
    }
    const onUp = (event: PointerEvent) => {
      move(event.clientX, event.clientY)
      clearAfterDragEnd()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', clearAfterDragEnd)
    window.addEventListener('blur', clear)
    return () => {
      if (clearTimer !== null) window.clearTimeout(clearTimer)
      clear()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', clearAfterDragEnd)
      window.removeEventListener('blur', clear)
    }
  }, [move, surfaceRef])

  return { begin, move, isActive, moved, lastPointer }
}
